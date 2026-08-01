use std::sync::Arc;

use crate::app::{protocols, window};
use crate::invoke_handler;
use crate::storage::database;
use crate::transcription::ParakeetService;
use crate::video::jobs::registry::NativeJobRegistry;
use tauri::Manager;
use tauri_plugin_log::{Target, TargetKind};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default().plugin(
        tauri_plugin_log::Builder::new()
            .targets([Target::new(TargetKind::Stderr)])
            .build(),
    );
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _, _| {
        if let Some(window) = app.get_webview_window("main") { let _ = window.show(); let _ = window.set_focus(); }
    }));
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_deep_link::init());
    protocols::register(builder)
        .manage(NativeJobRegistry::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(invoke_handler!())
        .setup(|app| {
            app.manage(ParakeetService::new(app.handle().clone()));
            let local_db = tauri::async_runtime::block_on(database::initialize_database(app.handle())).map_err(std::io::Error::other)?;
            let db_for_mcp = Arc::new(local_db.database.clone());
            let db_for_cleanup = local_db.database.clone();
            let app_for_cleanup = app.handle().clone();
            app.manage(local_db);
            tauri::async_runtime::spawn(async move {
                match crate::storage::export_cleanup::purge_missing_on_disk(
                    &app_for_cleanup,
                    &db_for_cleanup,
                    None,
                )
                .await
                {
                    Ok(count) if count > 0 => {
                        log::info!("Purged {count} clipper exports missing on disk");
                    }
                    Ok(_) => {}
                    Err(error) => {
                        log::warn!("Failed to purge missing clipper exports: {error}");
                    }
                }

                match crate::storage::export_cleanup::delete_orphaned_project_exports(&db_for_cleanup)
                    .await
                {
                    Ok(count) if count > 0 => {
                        log::info!("Purged {count} orphaned clipper exports");
                    }
                    Ok(_) => {}
                    Err(error) => {
                        log::warn!("Failed to purge orphaned clipper exports: {error}");
                    }
                }
            });
            let mcp_port = crate::mcp::resolve_mcp_http_port();
            if let Ok(mcp_http) = tauri::async_runtime::block_on(
                crate::mcp::start_mcp_http_server(db_for_mcp, mcp_port),
            ) {
                app.manage(mcp_http);
            } else {
                log::error!("Open Clipper MCP HTTP server failed to start on port {mcp_port}");
            }
            #[cfg(any(windows, target_os = "linux"))]
            { use tauri_plugin_deep_link::DeepLinkExt; app.deep_link().register_all()?; }
            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                window::apply_webview_background(&window);
                window::attach_webview_crash_recovery(&window);
            }
            // The main window is intentionally created hidden to avoid a white WebView
            // flash. Always reveal it once native initialization has completed: without
            // this fallback a production/preview launch can remain running but invisible.
            window::show_main_window(app.handle());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Tauri application");
}
