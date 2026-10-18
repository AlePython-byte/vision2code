use std::fs;
use keyring::Entry;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

mod export;
mod preview;

const RELEASE_IDENTIFIER: &str = "com.vision2code.desktop";
/// The entry the released app has always used; kept so existing installs keep their session.
const RELEASE_KEYRING_SERVICE: &str = "vision2code";
const KEYRING_USER: &str = "vault_master_key";

/// The keyring entry belongs to the app identifier, like the vault file (`app_local_data_dir`) and the WebView profile:
/// `desktop:dev` runs with its own identifier (`tauri.dev.conf.json`) and so never reads or overwrites the installed app's key.
fn keyring_service(identifier: &str) -> String {
    if identifier == RELEASE_IDENTIFIER { RELEASE_KEYRING_SERVICE.to_string() } else { identifier.to_string() }
}

pub fn get_or_create_vault_master_key(service: &str) -> Result<String, String> {
    let entry = Entry::new(service, KEYRING_USER).map_err(|e| e.to_string())?;

    match entry.get_password() {
        Ok(existing_key) if !existing_key.trim().is_empty() => {
            if cfg!(debug_assertions) {
                eprintln!("[Stronghold] credential key retrieved: yes");
            }
            Ok(existing_key.trim().to_string())
        }
        Ok(_) | Err(keyring::Error::NoEntry) => {
            if cfg!(debug_assertions) {
                eprintln!("[Stronghold] credential key retrieved: no (generating new)");
            }
            // Generate a random 256-bit (32 bytes) master key using OS CSPRNG
            let mut key_bytes = [0u8; 32];
            getrandom::getrandom(&mut key_bytes).map_err(|e| e.to_string())?;
            let key_hex: String = key_bytes.iter().map(|b| format!("{:02x}", b)).collect();

            // Persist securely in OS Credential Store (Windows Credential Manager / macOS Keychain / Linux Secret Service)
            entry.set_password(&key_hex).map_err(|e| e.to_string())?;
            Ok(key_hex)
        }
        Err(err) => {
            if cfg!(debug_assertions) {
                eprintln!("[Stronghold] credential key error: {}", err);
            }
            Err(format!("OS credential storage error: {}", err))
        }
    }
}

#[tauri::command]
fn get_vault_key(app: tauri::AppHandle) -> Result<String, String> {
    // Delete legacy plaintext vault.key if it exists from previous uncommitted builds
    if let Ok(app_dir) = app.path().app_local_data_dir() {
        let legacy_key_path = app_dir.join("vault.key");
        if legacy_key_path.exists() {
            let _ = fs::remove_file(&legacy_key_path);
        }
    }

    get_or_create_vault_master_key(&keyring_service(&app.config().identifier))
}

#[tauri::command]
fn get_vault_path(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let vault_path = app_dir.join("vault.hold");
    Ok(vault_path.to_string_lossy().to_string())
}

/// Exports the editor's working copy. The webview sends only relative paths, text and a suggested
/// name; the destination is chosen in a native dialog opened here, so no path ever comes from the
/// webview and it needs no filesystem permission. Files are validated before the dialog opens.
#[tauri::command]
async fn export_project(
    app: tauri::AppHandle,
    window: tauri::Window,
    files: Vec<export::ExportFile>,
    suggested_name: String,
) -> export::ExportResult {
    if let Err(code) = export::validate_files(&files) {
        return export::ExportResult::Failed { code };
    }
    let job = tauri::async_runtime::spawn_blocking(move || {
        // Blocking pickers must not run on the main thread; this is a worker thread.
        let picked = app.dialog().file().set_parent(&window).blocking_pick_folder();
        let Some(picked) = picked else { return export::ExportResult::Cancelled };
        match picked.into_path() {
            Ok(parent) => export::export_into(&parent, &files, &suggested_name),
            Err(_) => export::ExportResult::Failed { code: export::ExportErrorCode::DestinationInvalid },
        }
    });
    job.await.unwrap_or(export::ExportResult::Failed { code: export::ExportErrorCode::IoError })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        // The live preview's own origin, with its own CSP (see preview.rs).
        .register_uri_scheme_protocol(preview::SCHEME, |_ctx, request| preview::respond(&request))
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("salt.txt");
            app.handle().plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_vault_key, get_vault_path, export_project])
        .run(tauri::generate_context!())
        .expect("error while running Vision2Code");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_keyring_entry_follows_the_identifier_and_the_release_keeps_its_legacy_name() {
        assert_eq!(keyring_service("com.vision2code.desktop"), "vision2code", "installed apps keep their session");
        assert_eq!(keyring_service("com.vision2code.desktop.dev"), "com.vision2code.desktop.dev");
        assert_ne!(keyring_service("com.vision2code.desktop.dev"), keyring_service("com.vision2code.desktop"));
    }

    #[test]
    #[ignore = "uses the real OS credential store (absent on headless CI); run locally with `cargo test -- --ignored`"]
    fn test_keyring_retrieval_and_stability() {
        // A throwaway service name: this ignored test never touches the app's real entry.
        let service = "vision2code.keyring-test";
        let key1 = get_or_create_vault_master_key(service).expect("first key retrieval should succeed");
        assert_eq!(key1.len(), 64, "256-bit key hex should be 64 characters");
        let key2 = get_or_create_vault_master_key(service).expect("second key retrieval should succeed");
        assert_eq!(key1, key2, "keyring must return the same master key across calls");
    }
}
