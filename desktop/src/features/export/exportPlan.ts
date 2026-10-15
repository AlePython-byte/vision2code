/**
 * Early, pure validation of an export. It mirrors the native rules in `src-tauri/src/export.rs`,
 * which stay authoritative: this layer only gives feedback before the native dialog opens.
 * No AI, generator, auth, toast or Tauri imports.
 */

// Keep in sync with src-tauri/src/export.rs (a test compares both).
export const MAX_EXPORT_FILES = 200;
export const MAX_EXPORT_FILE_BYTES = 1_000_000;
export const MAX_EXPORT_TOTAL_BYTES = 5_000_000;
export const MAX_EXPORT_PATH_CHARS = 160;
export const MAX_EXPORT_SEGMENT_CHARS = 64;
export const MAX_EXPORT_FOLDER_NAME_CHARS = 48;
export const FALLBACK_EXPORT_FOLDER_NAME = "vision2code-export";

export type ExportErrorCode =
  | "NO_FILES" | "INVALID_PATH" | "PATH_TOO_LONG" | "DUPLICATE_PATH" | "INVALID_CONTENT"
  | "TOO_MANY_FILES" | "TOO_LARGE" | "DESTINATION_INVALID" | "PERMISSION_DENIED" | "IO_ERROR"
  /** Desktop-only: there is no native runtime (for example the browser dev shell). */
  | "UNAVAILABLE";

export interface ExportFileInput {
  readonly path: string;
  readonly content: string;
}

export interface ExportPlan {
  /** Raw project name for the native side, which sanitizes it again. */
  readonly suggestedName: string;
  /** What the native side will name the folder before any -2, -3 suffix. */
  readonly folderName: string;
  readonly files: readonly ExportFileInput[];
}

export type ExportPlanResult =
  | { readonly ok: true; readonly plan: ExportPlan }
  | { readonly ok: false; readonly code: ExportErrorCode };

const RESERVED = new Set(["CON", "PRN", "AUX", "NUL", "CONIN$", "CONOUT$",
  ...Array.from({ length: 9 }, (_, index) => `COM${index + 1}`), ...Array.from({ length: 9 }, (_, index) => `LPT${index + 1}`)]);

function isReserved(segment: string): boolean {
  return RESERVED.has((segment.split(".")[0] ?? segment).toUpperCase());
}

const SAFE_PATH = /^[A-Za-z0-9._/-]+$/;

/** Same rules as the native `validate_path`: ASCII allowlist, no empty/`.`/`..` segments, no reserved names. */
export function validateExportPath(path: string): ExportErrorCode | null {
  if (!path) return "INVALID_PATH";
  if ([...path].length > MAX_EXPORT_PATH_CHARS) return "PATH_TOO_LONG";
  if (!SAFE_PATH.test(path)) return "INVALID_PATH";
  for (const segment of path.split("/")) {
    if (!segment || segment === "." || segment === "..") return "INVALID_PATH";
    if (segment.length > MAX_EXPORT_SEGMENT_CHARS) return "PATH_TOO_LONG";
    if (segment.endsWith(".") || segment.endsWith(" ") || isReserved(segment)) return "INVALID_PATH";
  }
  return null;
}

/** Same folder naming as the native `sanitize_folder_name`. */
export function sanitizeExportFolderName(suggested: string): string {
  let name = "";
  for (const char of suggested) {
    const next = /[\p{L}\p{N}_-]/u.test(char) ? char : "-";
    if (next === "-" && name.endsWith("-")) continue;
    name += next;
  }
  const trim = (value: string) => value.replace(/^[-_.]+|[-_.]+$/g, "");
  name = trim([...trim(name)].slice(0, MAX_EXPORT_FOLDER_NAME_CHARS).join(""));
  if (!name) return FALLBACK_EXPORT_FOLDER_NAME;
  return isReserved(name) ? `${name}-export` : name;
}

const encoder = new TextEncoder();

export function buildExportPlan(files: readonly ExportFileInput[], projectName: string | null): ExportPlanResult {
  if (files.length === 0) return { ok: false, code: "NO_FILES" };
  if (files.length > MAX_EXPORT_FILES) return { ok: false, code: "TOO_MANY_FILES" };
  let total = 0;
  const fileKeys = new Set<string>();
  const folderKeys = new Set<string>();
  for (const file of files) {
    const invalid = validateExportPath(file.path);
    if (invalid) return { ok: false, code: invalid };
    if (file.content.includes("\0")) return { ok: false, code: "INVALID_CONTENT" };
    const bytes = encoder.encode(file.content).length;
    if (bytes > MAX_EXPORT_FILE_BYTES) return { ok: false, code: "TOO_LARGE" };
    total += bytes;
    if (total > MAX_EXPORT_TOTAL_BYTES) return { ok: false, code: "TOO_LARGE" };
    const key = file.path.toLowerCase();
    if (fileKeys.has(key)) return { ok: false, code: "DUPLICATE_PATH" };
    fileKeys.add(key);
    const segments = key.split("/");
    for (let end = 1; end < segments.length; end++) folderKeys.add(segments.slice(0, end).join("/"));
  }
  for (const key of fileKeys) if (folderKeys.has(key)) return { ok: false, code: "DUPLICATE_PATH" };
  const suggestedName = projectName?.trim() || FALLBACK_EXPORT_FOLDER_NAME;
  return {
    ok: true,
    plan: Object.freeze({
      suggestedName,
      folderName: sanitizeExportFolderName(suggestedName),
      files: Object.freeze(files.map((file) => Object.freeze({ path: file.path, content: file.content }))),
    }),
  };
}

/** The editor's working copy: every file, with its unsaved Monaco draft when there is one. */
export function workingCopyFiles(state: {
  readonly files: readonly { readonly path: string; readonly content: string }[];
  readonly drafts: ReadonlyMap<string, string>;
}): ExportFileInput[] {
  return state.files.map((file) => ({ path: file.path, content: state.drafts.get(file.path) ?? file.content }));
}
