// Declaring the app's commands enables the ACL for them: the webview can only invoke a command
// whose `allow-*` permission is granted in `capabilities/`. Keep in sync with `generate_handler!`.
const COMMANDS: &[&str] = &["get_vault_key", "get_vault_path", "export_project", "lifecycle_log"];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run tauri-build");
}
