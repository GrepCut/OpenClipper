mod clipper_data;
mod commands;
mod database;
mod entity;
mod error;
mod media_protocol;
mod migrator;
mod model_cache;
mod repository;
pub mod transcription;
mod video_processing;

use tauri::Manager;
use transcription::ParakeetService;

/// Pokazuje główne okno i zamyka splash. Idempotentne — wywoływane zarówno
/// przez frontend po pierwszym renderze, jak i przez fallback timer w setup.
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let already_visible = main.is_visible().unwrap_or(false);
        if !already_visible {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
}

#[tauri::command]
fn frontend_ready(
    app: tauri::AppHandle,
    session_id: String,
    jobs: tauri::State<'_, video_processing::NativeJobRegistry>,
) -> Result<(), String> {
    let retired = jobs.activate_session(&session_id)?;
    video_processing::cleanup_clipper_frame_sessions(&retired);
    show_main_window(&app);
    Ok(())
}

#[cfg(windows)]
fn apply_webview_background(window: &tauri::WebviewWindow) {
    let _ = window.with_webview(|webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2Controller2, ICoreWebView2Settings9, COREWEBVIEW2_COLOR,
        };
        use windows::core::Interface;

        unsafe {
            let controller = webview.controller();
            if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
                let color = COREWEBVIEW2_COLOR {
                    A: 255,
                    R: 0x01,
                    G: 0x04,
                    B: 0x09,
                };
                let _ = controller2.SetDefaultBackgroundColor(color);
            }

            // Non-client region support: elementy z CSS `app-region: drag` są
            // hit-testowane przez proces przeglądarki WebView2, więc przeciąganie
            // okna działa nawet gdy wątek JS jest zablokowany (runtime >= 123).
            if let Ok(core) = controller.CoreWebView2() {
                if let Ok(settings) = core.Settings() {
                    if let Ok(settings9) = settings.cast::<ICoreWebView2Settings9>() {
                        let _ = settings9.SetIsNonClientRegionSupportEnabled(true);
                    }
                }
            }
        }
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            #[cfg(debug_assertions)]
            log::info!("[auth] secondary instance argv: {:?}", argv);
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }));
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder
        .manage(video_processing::NativeJobRegistry::default())
        .on_page_load(|webview, payload| {
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                let jobs = webview.state::<video_processing::NativeJobRegistry>();
                let retired = jobs.retire_active_session();
                video_processing::cleanup_clipper_frame_sessions(&retired);
            }
        })
        .register_asynchronous_uri_scheme_protocol("grepcut-media", |_ctx, request, responder| {
            // Ograniczona pula blocking tokio zamiast wątku-na-request — scrubbing
            // wideo potrafi generować dziesiątki range-requestów na sekundę.
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media_protocol::media_protocol_handler(request));
            });
        })
        .register_asynchronous_uri_scheme_protocol("grepcut-models", |ctx, request, responder| {
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(model_cache::models_protocol_handler(&app, request));
            });
        })
        .plugin(
            tauri::plugin::Builder::<tauri::Wry, ()>::new("block-external-nav")
                .on_navigation(|webview, url| {
                    let scheme = url.scheme();
                    let is_local = scheme == "asset"
                        || scheme == "grepcut-media"
                        || scheme == "tauri"
                        || url.host_str() == Some("grepcut-media.localhost")
                        || url.host_str() == Some("localhost")
                        || url.host_str() == Some("127.0.0.1")
                        || url.host_str().map_or(false, |h| h.ends_with(".localhost"));

                    if !is_local {
                        use tauri::Manager;
                        use tauri_plugin_opener::OpenerExt;
                        let _ = webview
                            .app_handle()
                            .opener()
                            .open_url(url.as_str().to_string(), None::<String>);
                    }
                    is_local
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            frontend_ready,
            video_processing::start_clipper_media_extraction,
            video_processing::probe_clipper_winml,
            video_processing::start_clipper_winml_analysis,
            video_processing::cancel_clipper_native_job,
            video_processing::cleanup_clipper_frames,
            video_processing::snap_clipper_to_keyframe,
            video_processing::extract_clipper_segment,
            media_protocol::register_media_source,
            clipper_data::open_clipper_projects_dir,
            clipper_data::ensure_clipper_project_data_dir,
            clipper_data::remove_clipper_project_data_dir,
            clipper_data::read_clipper_project_data_file,
            clipper_data::write_clipper_project_data_file,
            clipper_data::write_clipper_project_data_bytes,
            clipper_data::get_clipper_project_data_file_path,
            clipper_data::extract_clipper_segment_to_project_data,
            clipper_data::ensure_clipper_project_exports_dir,
            clipper_data::write_clipper_export_file_bytes_at,
            clipper_data::remove_clipper_export_file,
            clipper_data::get_clipper_export_file_path,
            clipper_data::stat_clipper_export_file,
            clipper_data::open_clipper_project_exports_dir,
            commands::local_db_commands::local_database_info,
            commands::local_db_commands::local_project_put,
            commands::local_db_commands::local_project_get,
            commands::local_db_commands::local_project_list,
            commands::local_db_commands::local_project_delete,
            commands::local_db_commands::local_record_get,
            commands::local_db_commands::local_record_put,
            commands::local_db_commands::local_record_delete,
            commands::transcription::get_parakeet_model_status,
            commands::transcription::probe_parakeet_transcription,
            commands::transcription::download_parakeet_model,
            commands::transcription::delete_parakeet_model,
            commands::transcription::load_parakeet_model,
            commands::transcription::transcribe_parakeet_local,
            commands::transcription::start_parakeet_transcription,
        ])
        .setup(|app| {
            app.manage(ParakeetService::new(app.handle().clone()));
            let local_db =
                tauri::async_runtime::block_on(database::initialize_database(app.handle()))
                    .map_err(std::io::Error::other)?;
            app.manage(local_db);

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
            }

            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_webview_background(&window);
            }

            // Bezpiecznik: gdyby frontend nigdy nie zasygnalizował gotowości
            // (np. crash JS przy starcie), pokaż główne okno po 15 s.
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(15));
                    show_main_window(&handle);
                });
            }

            video_processing::cleanup_clipper_frames_cache_on_startup(app.handle());

            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
