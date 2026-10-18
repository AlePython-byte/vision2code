//! Optional lifecycle log, to characterise "the app does not close" reports.
//!
//! Off unless the app is started with `VISION2CODE_DEBUG_LIFECYCLE=1`. Then it appends one line per event to
//! `<app local data dir>/lifecycle.log` (rotated to `lifecycle.log.1` past 256 KiB): milliseconds since the Unix epoch,
//! milliseconds since start, process id, thread name and an event name. Event names are a closed list: the webview can
//! only send names from `CLIENT_EVENTS`, so no free text (paths, e-mails, tokens) can ever reach the file.
//! Writing never blocks the caller for long, never panics and never fails the app: errors are swallowed.

use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub const ENV: &str = "VISION2CODE_DEBUG_LIFECYCLE";
pub const FILE_NAME: &str = "lifecycle.log";
const MAX_BYTES: u64 = 256 * 1024;

/// Events the webview may report. Keep in sync with `LIFECYCLE_EVENTS` in `desktop/src/features/lifecycle/lifecycleLog.ts`.
pub const CLIENT_EVENTS: &[&str] = &[
    "signout:start", "signout:done", "signout:error",
    "vault:init:start", "vault:init:done", "vault:init:fallback",
    "vault:save:start", "vault:save:done", "vault:save:error",
    "vault:remove:start", "vault:remove:done", "vault:remove:error",
    "vault:clear:start", "vault:clear:done", "vault:clear:error", "vault:write:blocked",
    "page:hide",
];

pub fn enabled_from(value: Option<&str>) -> bool {
    value.map(str::trim) == Some("1")
}

pub struct Lifecycle {
    path: Option<PathBuf>,
    started: Instant,
    write: Mutex<()>,
}

impl Lifecycle {
    /// `dir` is the app local data dir; `None` (or disabled) makes every call a no-op.
    pub fn new(enabled: bool, dir: Option<PathBuf>) -> Self {
        let path = if enabled { dir.map(|dir| dir.join(FILE_NAME)) } else { None };
        Self { path, started: Instant::now(), write: Mutex::new(()) }
    }

    pub fn log(&self, event: &str) {
        let Some(path) = &self.path else { return };
        let since_epoch = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0);
        let line = format_line(since_epoch, self.started.elapsed().as_millis(), std::process::id(), thread_name().as_str(), event);
        let _guard = self.write.lock().unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if fs::metadata(path).map(|m| m.len() > MAX_BYTES).unwrap_or(false) {
            let _ = fs::rename(path, path.with_extension("log.1"));
        }
        if let Ok(mut file) = OpenOptions::new().create(true).append(true).open(path) {
            let _ = file.write_all(line.as_bytes());
        }
    }

    /// Logs a webview event only when it is one of the known names.
    pub fn log_client(&self, event: &str) -> Result<(), String> {
        if !CLIENT_EVENTS.contains(&event) {
            return Err("unknown lifecycle event".into());
        }
        self.log(&format!("client:{event}"));
        Ok(())
    }
}

fn thread_name() -> String {
    let current = std::thread::current();
    current.name().map(str::to_string).unwrap_or_else(|| format!("{:?}", current.id()))
}

pub fn format_line(epoch_ms: u128, uptime_ms: u128, pid: u32, thread: &str, event: &str) -> String {
    let safe: String = event.chars().map(|c| if c.is_ascii_graphic() || c == ' ' || c == '=' { c } else { '?' }).collect();
    let thread: String = thread.chars().filter(|c| c.is_ascii_graphic()).take(40).collect();
    format!("{epoch_ms} +{uptime_ms}ms pid={pid} thread={thread} {safe}\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("v2c-lifecycle-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn only_exactly_1_enables_it() {
        assert!(enabled_from(Some("1")));
        assert!(enabled_from(Some(" 1 ")));
        for value in [None, Some(""), Some("0"), Some("true"), Some("yes")] {
            assert!(!enabled_from(value), "{value:?}");
        }
    }

    #[test]
    fn disabled_writes_nothing() {
        let dir = temp_dir("off");
        let log = Lifecycle::new(false, Some(dir.clone()));
        log.log("app:start");
        assert!(log.log_client("signout:start").is_ok());
        assert!(!dir.join(FILE_NAME).exists());
    }

    #[test]
    fn enabled_appends_one_line_per_event_with_no_free_text() {
        let dir = temp_dir("on");
        let log = Lifecycle::new(true, Some(dir.clone()));
        log.log("app:start");
        log.log_client("signout:start").unwrap();
        assert!(log.log_client("someone@example.com").is_err(), "free text is refused");
        assert!(log.log_client("C:\\Users\\x\\vault.hold").is_err());
        let text = fs::read_to_string(dir.join(FILE_NAME)).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 2);
        assert!(lines[0].ends_with(" app:start"));
        assert!(lines[1].ends_with(" client:signout:start"));
        assert!(lines[0].contains(" pid=") && lines[0].contains(" +") && lines[0].contains("ms "));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn rotates_past_the_size_limit_instead_of_growing_forever() {
        let dir = temp_dir("rotate");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(FILE_NAME), vec![b'x'; (MAX_BYTES + 1) as usize]).unwrap();
        Lifecycle::new(true, Some(dir.clone())).log("app:exit");
        assert!(dir.join("lifecycle.log.1").exists());
        assert!(fs::read_to_string(dir.join(FILE_NAME)).unwrap().ends_with(" app:exit\n"));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn a_line_never_carries_control_characters() {
        let line = format_line(1, 2, 3, "main", "x\ny\u{7}z");
        assert_eq!(line, "1 +2ms pid=3 thread=main x?y?z\n");
    }
}
