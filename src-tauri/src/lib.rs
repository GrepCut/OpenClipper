mod cli;
mod clipper_data;
mod commands;
mod database;
mod entity;
mod error;
mod media_protocol;
mod migrator;
mod model_cache;
mod repository;
mod startup_log;
pub mod transcription;
mod video_processing;

use tauri::Manager;
use transcription::ParakeetService;

pub fn install_startup_diagnostics() {
    startup_log::install_panic_hook();
}

/// Pokazuje główne okno. Idempotentne — wywoływane zarówno przez frontend
/// po pierwszym renderze, jak i przez fallback timer w setup.
fn show_main_window(app: &tauri::AppHandle) {
    if cli::is_benchmark_cli_active() {
        if let Some(main) = app.get_webview_window("main") {
            let _ = main.hide();
        }
        return;
    }
    if let Some(main) = app.get_webview_window("main") {
        let already_visible = match main.is_visible() {
            Ok(visible) => visible,
            Err(error) => {
                log::error!(target: "startup", "failed to read main window visibility: {error}");
                false
            }
        };
        if !already_visible {
            if let Err(error) = main.show() {
                log::error!(target: "startup", "failed to show main window: {error}");
            }
            if let Err(error) = main.set_focus() {
                log::error!(target: "startup", "failed to focus main window: {error}");
            }
            log::info!(target: "startup", "main window show requested; {}", startup_log::context());
        }
    } else {
        log::error!(target: "startup", "main WebView window was not found");
    }
}

fn main_window_is_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
}

#[tauri::command]
fn frontend_ready(
    session_id: String,
    jobs: tauri::State<'_, video_processing::NativeJobRegistry>,
) -> Result<(), String> {
    log::info!(target: "frontend", "frontend_ready received; session_id={session_id}");
    let retired = jobs.activate_session(&session_id)?;
    video_processing::cleanup_clipper_frame_sessions(&retired);
    Ok(())
}

#[tauri::command]
fn frontend_startup_log(level: String, message: String, details: Option<String>) {
    let message = match details {
        Some(details) if !details.is_empty() => format!("{message}; details={details}"),
        _ => message,
    };
    let message = format!("{message}; {}", startup_log::context());

    match level.as_str() {
        "error" => log::error!(target: "frontend", "{message}"),
        "warn" => log::warn!(target: "frontend", "{message}"),
        "debug" => log::debug!(target: "frontend", "{message}"),
        _ => log::info!(target: "frontend", "{message}"),
    }
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
    use tauri_plugin_log::{
        FileOpenStrategy, RotationStrategy, Target, TargetKind, TimezoneStrategy,
    };

    let cli_request = cli::parse_args();
    let cli_mode = cli_request.is_some();
    if cli_mode {
        cli::attach_parent_console();
    }

    let log_directory = startup_log::directory();
    startup_log::append(&format!(
        "initializing Tauri; log_file={}",
        startup_log::path().display()
    ));

    let production_log = tauri_plugin_log::Builder::new()
        .level(log::LevelFilter::Info)
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .file_open_strategy(FileOpenStrategy::Append)
        .rotation_strategy(RotationStrategy::KeepSome(5))
        .max_file_size(5_000_000)
        .targets([
            Target::new(TargetKind::Folder {
                path: log_directory,
                file_name: Some(startup_log::FILE_STEM.to_string()),
            }),
            Target::new(TargetKind::Stderr),
        ])
        .build();

    let mut builder = tauri::Builder::default().plugin(production_log);

    #[cfg(desktop)]
    {
        if !cli_mode {
            builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
                log::info!("[auth] secondary instance argv: {:?}", argv);
                if cli::is_benchmark_cli_argv(&argv) {
                    log::warn!(
                        target: "cli",
                        "benchmark CLI requested while another instance is running; close Open Clipper and retry"
                    );
                    return;
                }
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }));
        }
        builder = builder.plugin(tauri_plugin_deep_link::init());
    }

    builder
        .manage(cli_request.clone())
        .manage(video_processing::NativeJobRegistry::default())
        .on_page_load(|webview, payload| {
            log::info!(
                target: "startup",
                "webview page load; label={}; event={:?}; url={}; {}",
                webview.label(),
                payload.event(),
                payload.url(),
                startup_log::context()
            );
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Started
            {
                let jobs = webview.state::<video_processing::NativeJobRegistry>();
                let retired = jobs.retire_active_session();
                video_processing::cleanup_clipper_frame_sessions(&retired);
            }
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                show_main_window(webview.app_handle());
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
            frontend_startup_log,
            cli::get_benchmark_cli_request,
            cli::log_benchmark_cli_progress,
            cli::finish_benchmark_cli_command,
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
            clipper_data::write_clipper_project_data_raw,
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
            commands::test_benchmark::test_dataset_list,
            commands::test_benchmark::test_dataset_get,
            commands::test_benchmark::test_dataset_create,
            commands::test_benchmark::test_dataset_update,
            commands::test_benchmark::test_dataset_delete,
            commands::test_benchmark::test_clip_list,
            commands::test_benchmark::test_clip_get,
            commands::test_benchmark::test_clip_create,
            commands::test_benchmark::test_clip_delete,
            commands::test_benchmark::test_clip_annotations_get,
            commands::test_benchmark::test_clip_annotations_replace,
            commands::test_benchmark::test_clip_file_path,
            commands::test_benchmark::open_test_dataset_dir,
            commands::test_benchmark::benchmark_run_create,
            commands::test_benchmark::benchmark_run_finish,
            commands::test_benchmark::benchmark_run_list,
            commands::test_benchmark::benchmark_result_put,
            commands::test_benchmark::benchmark_result_list,
            commands::test_benchmark::write_test_run_artifact,
            commands::test_benchmark::test_dataset_export,
            commands::test_benchmark::test_dataset_import,
            commands::test_benchmark::benchmark_miss_export::export_benchmark_miss_frames,
            commands::test_benchmark::benchmark_miss_export::export_benchmark_run_miss_frames,
            commands::transcription::get_parakeet_model_status,
            commands::transcription::probe_parakeet_transcription,
            commands::transcription::download_parakeet_model,
            commands::transcription::delete_parakeet_model,
            commands::transcription::load_parakeet_model,
            commands::transcription::transcribe_parakeet_local,
            commands::transcription::start_parakeet_transcription,
        ])
        .setup(move |app| {
            log::info!(target: "startup", "Tauri setup started");
            app.manage(ParakeetService::new(app.handle().clone()));
            log::info!(target: "startup", "Parakeet service initialized");
            let local_db =
                tauri::async_runtime::block_on(database::initialize_database(app.handle()))
                    .map_err(std::io::Error::other)?;
            app.manage(local_db);
            log::info!(target: "startup", "local database initialized");

            if let Some(request) = app.state::<Option<cli::CliRequest>>().inner().clone() {
                match request {
                    cli::CliRequest::BenchmarkRun(benchmark_request) => {
                        match tauri::async_runtime::block_on(cli::ensure_dataset_exists(
                            app.handle(),
                            &benchmark_request.dataset_id,
                        )) {
                            Ok(dataset) => {
                                cli::print_cli_start(&benchmark_request, &dataset.name)
                            }
                            Err(error) => cli::exit_with_error(2, &error),
                        }
                    }
                    cli::CliRequest::ExtractMissFrames(extract_request) => {
                        cli::print_extract_start(&extract_request);
                        let result = tauri::async_runtime::block_on(
                            cli::run_extract_miss_frames_cli(app.handle(), &extract_request),
                        );
                        cli::finish_extract_miss_frames_cli(
                            app.handle(),
                            &extract_request,
                            result,
                        );
                    }
                }
            }

            #[cfg(any(windows, target_os = "linux"))]
            {
                use tauri_plugin_deep_link::DeepLinkExt;
                app.deep_link().register_all()?;
                log::info!(target: "startup", "deep links registered");
            }

            #[cfg(windows)]
            if let Some(window) = app.get_webview_window("main") {
                apply_webview_background(&window);
                log::info!(target: "startup", "WebView background configured");
            }

            if cli_mode {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                    log::info!(target: "cli", "benchmark CLI mode: main window kept hidden");
                }
            }

            // Shell HTML jest gotowy bez Reacta. Ten bezpiecznik nie pozwala,
            // by awaria samego page-load pozostawiła niewidoczne okno.
            if !cli_mode {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if main_window_is_visible(&handle) {
                        return;
                    }
                    log::warn!(
                        target: "startup",
                        "1-second window visibility fallback elapsed; {}",
                        startup_log::context()
                    );
                    show_main_window(&handle);
                });
            }

            video_processing::cleanup_clipper_frames_cache_on_startup(app.handle());
            log::info!(target: "startup", "startup setup completed");
            Ok(())
        })
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            log::error!(target: "startup", "fatal Tauri runtime error: {error:#}");
            startup_log::append(&format!("fatal Tauri runtime error: {error:#}"));
            panic!("error while running tauri application: {error:#}");
        });
}
