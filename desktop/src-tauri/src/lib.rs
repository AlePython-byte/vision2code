use std::fs;
use keyring::Entry;
use tauri::Manager;

const KEYRING_SERVICE: &str = "vision2code";
const KEYRING_USER: &str = "vault_master_key";

pub fn get_or_create_vault_master_key() -> Result<String, String> {
    let entry = Entry::new(KEYRING_SERVICE, KEYRING_USER).map_err(|e| e.to_string())?;

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

    get_or_create_vault_master_key()
}

#[tauri::command]
fn get_vault_path(app: tauri::AppHandle) -> Result<String, String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let vault_path = app_dir.join("vault.hold");
    Ok(vault_path.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let salt_path = app
                .path()
                .app_local_data_dir()
                .expect("could not resolve app local data path")
                .join("salt.txt");
            app.handle().plugin(tauri_plugin_stronghold::Builder::with_argon2(&salt_path).build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_vault_key, get_vault_path])
        .run(tauri::generate_context!())
        .expect("error while running Vision2Code");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_keyring_retrieval_and_stability() {
        let key1 = get_or_create_vault_master_key().expect("first key retrieval should succeed");
        assert_eq!(key1.len(), 64, "256-bit key hex should be 64 characters");
        let key2 = get_or_create_vault_master_key().expect("second key retrieval should succeed");
        assert_eq!(key1, key2, "keyring must return the same master key across calls");
    }
}
