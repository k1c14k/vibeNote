pub mod db;
pub mod model;
pub mod collections;
pub mod pieces;
pub mod contacts;
pub mod calendar;
pub mod vector_index;
pub mod mcp;






use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
};
use std::path::PathBuf;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

fn resolve_workspace_path() -> PathBuf {
    let args: Vec<String> = std::env::args().collect();
    for i in 0..args.len() {
        if (args[i] == "--workspace" || args[i] == "-w") && i + 1 < args.len() {
            return PathBuf::from(&args[i + 1]);
        }
    }
    if let Ok(path_str) = std::env::var("VIBE_PATH") {
        return PathBuf::from(path_str);
    }
    if let Ok(path_str) = std::env::var("VIBENOTE_WORKSPACE") {
        return PathBuf::from(path_str);
    }
    if let Ok(home) = std::env::var("HOME") {
        let p = PathBuf::from(home).join(".vibenote");
        if p.exists() {
            return p;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let is_mcp = std::env::args().any(|arg| arg == "--mcp");

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet])
        .setup(move |app| {
            let vibe_path = resolve_workspace_path();

            // Build system tray with Quit option
            let quit_i = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&quit_i)
                .build()?;

            let icon = app.default_window_icon().cloned()
                .unwrap_or_else(|| {
                    let bytes = include_bytes!("../icons/32x32.png");
                    tauri::image::Image::from_bytes(bytes).expect("Failed to load fallback icon")
                });

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .on_menu_event(|app, event| {
                    if event.id().as_ref() == "quit" {
                        app.cleanup_before_exit();
                        std::process::exit(0);
                    }
                })
                .build(app)?;

            if is_mcp {
                // Spawn stdio loop background thread
                let vibe_path_cloned = vibe_path.clone();
                std::thread::spawn(move || {
                    let stdin = std::io::stdin();
                    let mut stdout = std::io::stdout();
                    use std::io::BufRead;

                    let mut session = match crate::model::init_model() {
                        Ok(s) => s,
                        Err(e) => {
                            eprintln!("Failed to initialize ONNX model: {}", e);
                            return;
                        }
                    };

                    let db_path = vibe_path_cloned.join("vibe.db");
                    let mut conn = match crate::db::init_db(&db_path) {
                        Ok(c) => c,
                        Err(e) => {
                            eprintln!("Failed to initialize database: {}", e);
                            return;
                        }
                    };

                    // Auto-create default collection if empty
                    let count: i64 = conn.query_row("SELECT COUNT(*) FROM collections;", [], |row| row.get(0)).unwrap_or(0);
                    if count == 0 {
                        let _ = crate::collections::create_collection(&conn, &vibe_path_cloned, "Notes", "text", "notes");
                    }

                    for line in stdin.lock().lines() {
                        if let Ok(line_str) = line {
                            let response = crate::mcp::handle_mcp_message(&vibe_path_cloned, &mut conn, &mut session, &line_str);
                            use std::io::Write;
                            let _ = writeln!(stdout, "{}", response);
                            let _ = stdout.flush();
                        }
                    }
                });
            } else {
                // Build main window programmatically in normal mode
                tauri::WebviewWindowBuilder::new(
                    app,
                    "main",
                    tauri::WebviewUrl::App("index.html".into())
                )
                .title("vibeNote")
                .inner_size(800.0, 600.0)
                .build()?;
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(move |_app_handle, event| {
        match event {
            tauri::RunEvent::ExitRequested { api, .. } => {
                if is_mcp {
                    api.prevent_exit();
                }
            }
            _ => {}
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_resolve_workspace_path_defaults() {
        let path = resolve_workspace_path();
        assert!(path.exists() || path.parent().is_some());
    }
}
