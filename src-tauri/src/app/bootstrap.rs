use crate::app::{protocols, window};
use crate::cli::{self, CliRequest};
use crate::infra::startup_log;
use crate::invoke_handler;
use crate::storage::database;
use crate::transcription::ParakeetService;
use crate::video::jobs::registry::NativeJobRegistry;
use tauri::Manager;
use tauri_plugin_log::{FileOpenStrategy, RotationStrategy, Target, TargetKind, TimezoneStrategy};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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

    let builder = builder
        .manage(cli_request.clone())
        .manage(NativeJobRegistry::default())
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
                let jobs = webview.state::<NativeJobRegistry>();
                let _retired = jobs.retire_active_session();
            }
            if webview.label() == "main"
                && payload.event() == tauri::webview::PageLoadEvent::Finished
            {
                window::show_main_window(webview.app_handle());
            }
        });

    let builder = protocols::register(builder);
    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(invoke_handler!())
        .setup(move |app| {
            log::info!(target: "startup", "Tauri setup started");
            app.manage(ParakeetService::new(app.handle().clone()));
            log::info!(target: "startup", "Parakeet service initialized");
            let local_db =
                tauri::async_runtime::block_on(database::initialize_database(app.handle()))
                    .map_err(std::io::Error::other)?;
            app.manage(local_db);
            log::info!(target: "startup", "local database initialized");

            if let Some(request) = app.state::<Option<CliRequest>>().inner().clone() {
                match request {
                    CliRequest::BenchmarkRun(benchmark_request) => {
                        match tauri::async_runtime::block_on(cli::ensure_dataset_exists(
                            app.handle(),
                            &benchmark_request.dataset_id,
                        )) {
                            Ok(dataset) => cli::print_cli_start(&benchmark_request, &dataset.name),
                            Err(error) => cli::exit_with_error(2, &error),
                        }
                    }
                    CliRequest::ExtractMissFrames(extract_request) => {
                        cli::print_extract_start(&extract_request);
                        let result = tauri::async_runtime::block_on(
                            cli::run_extract_miss_frames_cli(app.handle(), &extract_request),
                        );
                        cli::finish_extract_miss_frames_cli(app.handle(), &extract_request, result);
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
                window::apply_webview_background(&window);
                log::info!(target: "startup", "WebView background configured");
            }

            if cli_mode {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                    log::info!(target: "cli", "benchmark CLI mode: main window kept hidden");
                }
            }

            if !cli_mode {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(1));
                    if window::main_window_is_visible(&handle) {
                        return;
                    }
                    log::warn!(
                        target: "startup",
                        "1-second window visibility fallback elapsed; {}",
                        startup_log::context()
                    );
                    window::show_main_window(&handle);
                });
            }

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
