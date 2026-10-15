//! Export of the editor's working copy to a new folder chosen by the user.
//!
//! Security model: the webview never sends a destination path and receives no filesystem
//! permission. It sends only relative file paths, their text and a suggested folder name.
//! Everything here is authoritative (the TypeScript checks only give early feedback):
//! every path is validated against an ASCII allowlist and Windows rules, sizes are bounded,
//! the export goes into a brand-new subfolder (never an existing one), files are created with
//! `create_new`, and a failure removes only what this export created.

use std::collections::HashSet;
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

pub const MAX_FILES: usize = 200;
pub const MAX_FILE_BYTES: usize = 1_000_000;
pub const MAX_TOTAL_BYTES: usize = 5_000_000;
/// Relative path length (characters); keeps the full path well under Windows' classic limit.
pub const MAX_PATH_CHARS: usize = 160;
pub const MAX_SEGMENT_CHARS: usize = 64;
pub const MAX_FOLDER_NAME_CHARS: usize = 48;
/// Collisions get -2, -3, ... up to this suffix before giving up.
pub const MAX_FOLDER_SUFFIX: u32 = 99;
pub const FALLBACK_FOLDER_NAME: &str = "vision2code-export";

const RESERVED_NAMES: [&str; 24] = [
    "CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
    "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
    "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
];

#[derive(Debug, Clone, Deserialize)]
pub struct ExportFile {
    pub path: String,
    pub content: String,
}

/// Stable, path-free error codes shared with the desktop UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportErrorCode {
    NoFiles,
    InvalidPath,
    PathTooLong,
    DuplicatePath,
    InvalidContent,
    TooManyFiles,
    TooLarge,
    DestinationInvalid,
    PermissionDenied,
    IoError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "SCREAMING_SNAKE_CASE")]
pub enum ExportResult {
    Exported {
        #[serde(rename = "folderName")]
        folder_name: String,
        #[serde(rename = "fileCount")]
        file_count: usize,
    },
    Cancelled,
    Failed { code: ExportErrorCode },
}

fn is_reserved(segment: &str) -> bool {
    // Windows reserves the device name with or without an extension ("nul.txt", "COM1.tsx").
    let stem = segment.split('.').next().unwrap_or(segment);
    RESERVED_NAMES.iter().any(|name| name.eq_ignore_ascii_case(stem))
}

/// Validates one relative path. Only ASCII letters, digits, `.`, `_`, `-` and `/` separators are
/// allowed, which already excludes backslashes, drive letters, `:` (alternate data streams),
/// control characters, NUL, spaces and every non-ASCII look-alike; the explicit checks below
/// cover the remaining traps (absolute and UNC paths, `.`/`..`, reserved names, trailing dots).
pub fn validate_path(path: &str) -> Result<(), ExportErrorCode> {
    if path.is_empty() {
        return Err(ExportErrorCode::InvalidPath);
    }
    if path.chars().count() > MAX_PATH_CHARS {
        return Err(ExportErrorCode::PathTooLong);
    }
    let allowed = |c: char| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '/');
    if !path.chars().all(allowed) {
        return Err(ExportErrorCode::InvalidPath);
    }
    // A leading "/" (absolute), "//" (UNC), "a//b" or a trailing "/" all produce an empty segment.
    for segment in path.split('/') {
        if segment.is_empty() || segment == "." || segment == ".." {
            return Err(ExportErrorCode::InvalidPath);
        }
        if segment.len() > MAX_SEGMENT_CHARS {
            return Err(ExportErrorCode::PathTooLong);
        }
        if segment.ends_with('.') || segment.ends_with(' ') || is_reserved(segment) {
            return Err(ExportErrorCode::InvalidPath);
        }
    }
    Ok(())
}

/// Validates the whole file set: count, per-file and total size, text content, and that no two
/// paths collide on a case-insensitive filesystem (including a file that is also a folder).
pub fn validate_files(files: &[ExportFile]) -> Result<(), ExportErrorCode> {
    if files.is_empty() {
        return Err(ExportErrorCode::NoFiles);
    }
    if files.len() > MAX_FILES {
        return Err(ExportErrorCode::TooManyFiles);
    }
    let mut total = 0usize;
    let mut file_keys = HashSet::new();
    let mut folder_keys = HashSet::new();
    for file in files {
        validate_path(&file.path)?;
        // Content is UTF-8 by construction (a JSON string); NUL marks binary data.
        if file.content.contains('\0') {
            return Err(ExportErrorCode::InvalidContent);
        }
        if file.content.len() > MAX_FILE_BYTES {
            return Err(ExportErrorCode::TooLarge);
        }
        total += file.content.len();
        if total > MAX_TOTAL_BYTES {
            return Err(ExportErrorCode::TooLarge);
        }
        // The allowlist is ASCII, so ASCII case folding is the full Windows/macOS comparison.
        let key = file.path.to_ascii_lowercase();
        if !file_keys.insert(key.clone()) {
            return Err(ExportErrorCode::DuplicatePath);
        }
        let segments: Vec<&str> = key.split('/').collect();
        for end in 1..segments.len() {
            folder_keys.insert(segments[..end].join("/"));
        }
    }
    if file_keys.iter().any(|key| folder_keys.contains(key)) {
        return Err(ExportErrorCode::DuplicatePath);
    }
    Ok(())
}

/// Folder name derived from the project name: letters (any script), digits, `-` and `_`;
/// everything else becomes a single `-`. Bounded length, no leading/trailing separators or dots,
/// never a reserved device name; falls back to `vision2code-export`.
pub fn sanitize_folder_name(suggested: &str) -> String {
    let mut name = String::new();
    for c in suggested.chars() {
        let keep = c.is_alphanumeric() || c == '_' || c == '-';
        let next = if keep { c } else { '-' };
        if next == '-' && name.ends_with('-') {
            continue;
        }
        name.push(next);
    }
    let trim = |value: &str| value.trim_matches(|c: char| c == '-' || c == '_' || c == '.').to_string();
    let mut name: String = trim(&name).chars().take(MAX_FOLDER_NAME_CHARS).collect();
    name = trim(&name);
    if name.is_empty() {
        return FALLBACK_FOLDER_NAME.to_string();
    }
    if is_reserved(&name) {
        name.push_str("-export");
    }
    name
}

fn io_code(error: &io::Error) -> ExportErrorCode {
    match error.kind() {
        io::ErrorKind::PermissionDenied | io::ErrorKind::ReadOnlyFilesystem => ExportErrorCode::PermissionDenied,
        _ => ExportErrorCode::IoError,
    }
}

/// Creates a new folder inside `parent`: `name`, then `name-2`, `name-3`, ... `create_dir` (never
/// `create_dir_all`) fails if the folder exists, so an existing folder is never reused or merged.
pub fn create_unique_folder(parent: &Path, name: &str) -> Result<PathBuf, ExportErrorCode> {
    match fs::metadata(parent) {
        Ok(metadata) if metadata.is_dir() => {}
        Ok(_) => return Err(ExportErrorCode::DestinationInvalid),
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Err(ExportErrorCode::DestinationInvalid),
        Err(error) => return Err(io_code(&error)),
    }
    for attempt in 1..=MAX_FOLDER_SUFFIX {
        let candidate = if attempt == 1 { name.to_string() } else { format!("{name}-{attempt}") };
        let path = parent.join(&candidate);
        match fs::create_dir(&path) {
            Ok(()) => return Ok(path),
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(error) => return Err(io_code(&error)),
        }
    }
    Err(ExportErrorCode::IoError)
}

/// Writes one new file; `create_new` refuses to open anything that already exists.
pub fn write_new_file(path: &Path, content: &str) -> io::Result<()> {
    let mut file = OpenOptions::new().write(true).create_new(true).open(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all()
}

/// Writes the validated files into the freshly created `root`. On any failure it removes, in
/// reverse order, exactly the files and folders it created (never `remove_dir_all`), then `root`.
pub fn write_files_into(
    root: &Path,
    files: &[ExportFile],
    write: &mut dyn FnMut(&Path, &str) -> io::Result<()>,
) -> Result<usize, ExportErrorCode> {
    let mut created_files: Vec<PathBuf> = Vec::new();
    let mut created_dirs: Vec<PathBuf> = Vec::new();
    let result = (|| {
        for file in files {
            let mut target = root.to_path_buf();
            let segments: Vec<&str> = file.path.split('/').collect();
            for segment in &segments[..segments.len() - 1] {
                target.push(segment);
                if !created_dirs.contains(&target) {
                    fs::create_dir(&target).map_err(|error| io_code(&error))?;
                    created_dirs.push(target.clone());
                }
            }
            target.push(segments[segments.len() - 1]);
            match write(&target, &file.content) {
                Ok(()) => created_files.push(target),
                Err(error) => {
                    // A partially written new file is ours too; one that already existed is not.
                    if error.kind() != io::ErrorKind::AlreadyExists && target.exists() {
                        created_files.push(target);
                    }
                    return Err(io_code(&error));
                }
            }
        }
        Ok(files.len())
    })();
    if result.is_err() {
        for file in created_files.iter().rev() {
            let _ = fs::remove_file(file);
        }
        for dir in created_dirs.iter().rev() {
            let _ = fs::remove_dir(dir);
        }
        let _ = fs::remove_dir(root);
    }
    result
}

/// Full export into `parent` (the folder the user picked natively): validate, create a unique
/// subfolder, write every file. Returns the folder's name only, never an internal path.
pub fn export_into(parent: &Path, files: &[ExportFile], suggested_name: &str) -> ExportResult {
    export_into_with(parent, files, suggested_name, &mut |path, content| write_new_file(path, content))
}

pub fn export_into_with(
    parent: &Path,
    files: &[ExportFile],
    suggested_name: &str,
    write: &mut dyn FnMut(&Path, &str) -> io::Result<()>,
) -> ExportResult {
    if let Err(code) = validate_files(files) {
        return ExportResult::Failed { code };
    }
    let root = match create_unique_folder(parent, &sanitize_folder_name(suggested_name)) {
        Ok(root) => root,
        Err(code) => return ExportResult::Failed { code },
    };
    match write_files_into(&root, files, write) {
        Ok(file_count) => ExportResult::Exported {
            folder_name: root.file_name().map(|name| name.to_string_lossy().into_owned()).unwrap_or_default(),
            file_count,
        },
        Err(code) => ExportResult::Failed { code },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn file(path: &str, content: &str) -> ExportFile {
        ExportFile { path: path.to_string(), content: content.to_string() }
    }

    /// Unique scratch directory under the OS temp dir, removed when dropped.
    struct TempDir(PathBuf);
    impl TempDir {
        fn new() -> Self {
            let mut bytes = [0u8; 8];
            getrandom::getrandom(&mut bytes).expect("random temp name");
            let name: String = bytes.iter().map(|b| format!("{b:02x}")).collect();
            let path = std::env::temp_dir().join(format!("v2c-export-test-{name}"));
            fs::create_dir(&path).expect("create temp dir");
            TempDir(path)
        }
    }
    impl Drop for TempDir {
        fn drop(&mut self) { let _ = fs::remove_dir_all(&self.0); }
    }

    fn entries(path: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(path).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn accepts_generated_project_paths() {
        for path in ["src/App.tsx", "src/generated/GeneratedInterface.tsx", "package.json", "a_b-c.d.ts", ".gitignore"] {
            assert_eq!(validate_path(path), Ok(()), "{path}");
        }
    }

    #[test]
    fn rejects_empty_absolute_unc_and_dot_segments() {
        for path in ["", "/etc/passwd", "//server/share/a.ts", "src//a.ts", "src/", "./a.ts", "src/./a.ts",
            "../a.ts", "src/../../a.ts", "..", "."] {
            assert_eq!(validate_path(path), Err(ExportErrorCode::InvalidPath), "{path:?}");
        }
    }

    #[test]
    fn rejects_backslashes_drive_letters_streams_controls_and_nul() {
        for path in ["src\\a.ts", "C:/a.ts", "C:a.ts", "a.ts:stream", "a.ts::$DATA", "\\\\server\\share\\a",
            "src/a\u{0}.ts", "src/a\n.ts", "src/a\t.ts", "src/a\u{7f}.ts", "a b.ts", "src/á.ts", "src/a\u{2215}b.ts",
            "src/a\u{ff0f}b.ts", "a<b.ts", "a>b.ts", "a\"b.ts", "a|b.ts", "a?b.ts", "a*b.ts"] {
            assert_eq!(validate_path(path), Err(ExportErrorCode::InvalidPath), "{path:?}");
        }
    }

    #[test]
    fn rejects_windows_reserved_names_with_or_without_extension_in_any_case() {
        for path in ["CON", "con.tsx", "src/PRN.ts", "aux", "Nul.json", "src/com1.ts", "COM9", "lpt1.txt", "LPT9.tsx", "src/nul.d.ts"] {
            assert_eq!(validate_path(path), Err(ExportErrorCode::InvalidPath), "{path}");
        }
        assert!(is_reserved("CONIN$") && is_reserved("conout$.txt"));
        assert_eq!(validate_path("src/console.ts"), Ok(()), "only exact device names are reserved");
        assert_eq!(validate_path("src/com10.ts"), Ok(()));
        assert_eq!(validate_path("src/auxiliary.ts"), Ok(()));
    }

    #[test]
    fn rejects_segments_ending_in_dot_or_space() {
        for path in ["src./a.ts", "src/a.", "a..", "src/name./x.ts"] {
            assert_eq!(validate_path(path), Err(ExportErrorCode::InvalidPath), "{path}");
        }
    }

    #[test]
    fn enforces_path_and_segment_length() {
        let long_segment = "a".repeat(MAX_SEGMENT_CHARS + 1);
        assert_eq!(validate_path(&long_segment), Err(ExportErrorCode::PathTooLong));
        let long_path = format!("{}/x.ts", ["abcdefghij"; 16].join("/"));
        assert!(long_path.len() > MAX_PATH_CHARS);
        assert_eq!(validate_path(&long_path), Err(ExportErrorCode::PathTooLong));
        assert_eq!(validate_path(&"a".repeat(MAX_SEGMENT_CHARS)), Ok(()));
    }

    #[test]
    fn detects_duplicates_ignoring_case_and_file_folder_conflicts() {
        assert_eq!(validate_files(&[file("src/App.tsx", "a"), file("SRC/app.TSX", "b")]), Err(ExportErrorCode::DuplicatePath));
        assert_eq!(validate_files(&[file("src", "a"), file("src/App.tsx", "b")]), Err(ExportErrorCode::DuplicatePath));
        assert_eq!(validate_files(&[file("Src/a.ts", "a"), file("src", "b")]), Err(ExportErrorCode::DuplicatePath));
        assert_eq!(validate_files(&[file("src/App.tsx", "a"), file("src/app.ts", "b")]), Ok(()));
    }

    #[test]
    fn enforces_file_count_sizes_and_text_content() {
        assert_eq!(validate_files(&[]), Err(ExportErrorCode::NoFiles));
        let many: Vec<ExportFile> = (0..=MAX_FILES).map(|i| file(&format!("f{i}.ts"), "")).collect();
        assert_eq!(validate_files(&many), Err(ExportErrorCode::TooManyFiles));
        assert_eq!(validate_files(&many[..MAX_FILES]), Ok(()));
        assert_eq!(validate_files(&[file("big.ts", &"x".repeat(MAX_FILE_BYTES + 1))]), Err(ExportErrorCode::TooLarge));
        assert_eq!(validate_files(&[file("max.ts", &"x".repeat(MAX_FILE_BYTES))]), Ok(()));
        let chunk = "x".repeat(MAX_FILE_BYTES);
        let total: Vec<ExportFile> = (0..=MAX_TOTAL_BYTES / MAX_FILE_BYTES).map(|i| file(&format!("f{i}.ts"), &chunk)).collect();
        assert_eq!(validate_files(&total), Err(ExportErrorCode::TooLarge));
        assert_eq!(validate_files(&[file("bin.ts", "a\0b")]), Err(ExportErrorCode::InvalidContent));
        assert_eq!(validate_files(&[file("utf8.ts", "const saludo = \"¡hola, señor! 🚀\";")]), Ok(()));
    }

    #[test]
    fn sanitizes_folder_names() {
        assert_eq!(sanitize_folder_name("Mi Página: v2/beta"), "Mi-Página-v2-beta");
        assert_eq!(sanitize_folder_name("  ..Dashboard..  "), "Dashboard");
        assert_eq!(sanitize_folder_name("a<>:\"/\\|?*b"), "a-b");
        assert_eq!(sanitize_folder_name(""), FALLBACK_FOLDER_NAME);
        assert_eq!(sanitize_folder_name("   ...   "), FALLBACK_FOLDER_NAME);
        assert_eq!(sanitize_folder_name("\u{0}\u{1f}"), FALLBACK_FOLDER_NAME);
        assert_eq!(sanitize_folder_name("CON"), "CON-export");
        assert_eq!(sanitize_folder_name("nul"), "nul-export");
        let long = sanitize_folder_name(&"proyecto ".repeat(20));
        assert!(long.chars().count() <= MAX_FOLDER_NAME_CHARS && !long.ends_with('-'), "{long}");
        for name in ["CON", "a b", "..", "C:\\Windows\\System32", "lpt1.txt", "  - _ .  ", "\\\\server\\share"] {
            let sanitized = sanitize_folder_name(name);
            assert!(!sanitized.is_empty() && !is_reserved(&sanitized), "{name:?} → {sanitized}");
            assert!(!sanitized.contains(|c: char| matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*' | ' ' | '.') || c.is_control()), "{sanitized}");
        }
    }

    #[test]
    fn exports_into_a_new_subfolder_with_exact_contents() {
        let temp = TempDir::new();
        let files = [file("src/App.tsx", "app"), file("src/generated/GeneratedInterface.tsx", "ui ✓")];
        let result = export_into(&temp.0, &files, "Alpha");
        assert_eq!(result, ExportResult::Exported { folder_name: "Alpha".into(), file_count: 2 });
        assert_eq!(fs::read_to_string(temp.0.join("Alpha/src/App.tsx")).unwrap(), "app");
        assert_eq!(fs::read_to_string(temp.0.join("Alpha/src/generated/GeneratedInterface.tsx")).unwrap(), "ui ✓");
    }

    #[test]
    fn never_overwrites_an_existing_folder_and_suffixes_collisions() {
        let temp = TempDir::new();
        fs::create_dir(temp.0.join("Alpha")).unwrap();
        fs::write(temp.0.join("Alpha/keep.txt"), "mine").unwrap();
        fs::create_dir(temp.0.join("Alpha-2")).unwrap();
        let result = export_into(&temp.0, &[file("keep.txt", "export")], "Alpha");
        assert_eq!(result, ExportResult::Exported { folder_name: "Alpha-3".into(), file_count: 1 });
        assert_eq!(fs::read_to_string(temp.0.join("Alpha/keep.txt")).unwrap(), "mine", "existing data untouched");
        assert_eq!(entries(&temp.0.join("Alpha-2")), Vec::<String>::new());
        assert_eq!(fs::read_to_string(temp.0.join("Alpha-3/keep.txt")).unwrap(), "export");
    }

    #[test]
    fn create_new_refuses_existing_files() {
        let temp = TempDir::new();
        let target = temp.0.join("exists.txt");
        fs::write(&target, "original").unwrap();
        assert_eq!(write_new_file(&target, "replacement").unwrap_err().kind(), io::ErrorKind::AlreadyExists);
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
    }

    #[test]
    fn destination_must_be_an_existing_directory() {
        let temp = TempDir::new();
        let not_dir = temp.0.join("file.txt");
        fs::write(&not_dir, "x").unwrap();
        assert_eq!(export_into(&not_dir, &[file("a.ts", "")], "Alpha"), ExportResult::Failed { code: ExportErrorCode::DestinationInvalid });
        assert_eq!(export_into(&temp.0.join("missing"), &[file("a.ts", "")], "Alpha"), ExportResult::Failed { code: ExportErrorCode::DestinationInvalid });
    }

    #[test]
    fn invalid_files_create_nothing() {
        let temp = TempDir::new();
        let result = export_into(&temp.0, &[file("src/App.tsx", "ok"), file("../escape.ts", "x")], "Alpha");
        assert_eq!(result, ExportResult::Failed { code: ExportErrorCode::InvalidPath });
        assert_eq!(entries(&temp.0), Vec::<String>::new(), "validation runs before any folder is created");
    }

    #[test]
    fn a_failure_midway_removes_only_what_this_export_created() {
        let temp = TempDir::new();
        fs::write(temp.0.join("unrelated.txt"), "keep").unwrap();
        let files = [file("src/a.ts", "1"), file("src/deep/b.ts", "2"), file("src/deep/c.ts", "3"), file("d.ts", "4")];
        let mut written = 0;
        let result = export_into_with(&temp.0, &files, "Alpha", &mut |path, content| {
            written += 1;
            if written == 3 {
                // Simulate a disk error after creating (and partially writing) the third file.
                fs::write(path, "partial")?;
                return Err(io::Error::new(io::ErrorKind::Other, "disk full"));
            }
            write_new_file(path, content)
        });
        assert_eq!(result, ExportResult::Failed { code: ExportErrorCode::IoError });
        assert_eq!(entries(&temp.0), vec!["unrelated.txt".to_string()], "the new folder and everything in it are gone");
        assert_eq!(fs::read_to_string(temp.0.join("unrelated.txt")).unwrap(), "keep");
    }

    #[test]
    fn cleanup_never_deletes_content_it_did_not_create() {
        let temp = TempDir::new();
        let files = [file("src/a.ts", "1"), file("src/b.ts", "2")];
        let mut written = 0;
        let result = export_into_with(&temp.0, &files, "Alpha", &mut |path, content| {
            written += 1;
            if written == 2 {
                // Someone else drops a file into the new folder meanwhile; it must survive.
                fs::write(path.parent().unwrap().join("foreign.txt"), "theirs")?;
                return Err(io::Error::new(io::ErrorKind::PermissionDenied, "denied"));
            }
            write_new_file(path, content)
        });
        assert_eq!(result, ExportResult::Failed { code: ExportErrorCode::PermissionDenied });
        assert_eq!(fs::read_to_string(temp.0.join("Alpha/src/foreign.txt")).unwrap(), "theirs");
        assert!(!temp.0.join("Alpha/src/a.ts").exists(), "our own file was removed");
    }

    #[test]
    fn result_serializes_to_the_ui_contract_without_paths() {
        let exported = serde_json::to_value(ExportResult::Exported { folder_name: "Alpha".into(), file_count: 2 }).unwrap();
        assert_eq!(exported, serde_json::json!({ "status": "EXPORTED", "folderName": "Alpha", "fileCount": 2 }));
        assert_eq!(serde_json::to_value(ExportResult::Cancelled).unwrap(), serde_json::json!({ "status": "CANCELLED" }));
        assert_eq!(serde_json::to_value(ExportResult::Failed { code: ExportErrorCode::PermissionDenied }).unwrap(),
            serde_json::json!({ "status": "FAILED", "code": "PERMISSION_DENIED" }));
    }
}
