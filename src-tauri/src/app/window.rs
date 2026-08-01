use tauri::Manager;

/// Pokazuje główne okno. Idempotentne — wywoływane zarówno przez frontend
/// po pierwszym renderze, jak i przez fallback timer w setup.
pub fn show_main_window(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        let already_visible = match main.is_visible() {
            Ok(visible) => visible,
            Err(_) => false,
        };
        if !already_visible {
            let _ = main.show();
            let _ = main.set_focus();
        }
    }
}

#[cfg(windows)]
pub fn apply_webview_background(window: &tauri::WebviewWindow) {
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

/// Reloads the WebView after renderer crashes instead of leaving STATUS_BREAKPOINT stuck.
#[cfg(windows)]
pub fn attach_webview_crash_recovery(window: &tauri::WebviewWindow) {
    let window_for_reload = window.clone();
    let _ = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            COREWEBVIEW2_PROCESS_FAILED_KIND,
            COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED,
        };
        use webview2_com::ProcessFailedEventHandler;

        unsafe {
            let controller = webview.controller();
            let core = match controller.CoreWebView2() {
                Ok(core) => core,
                Err(error) => {
                    log::warn!("WebView2 crash recovery skipped: CoreWebView2 unavailable ({error})");
                    return;
                }
            };

            let handler = ProcessFailedEventHandler::create(Box::new(move |_sender, args| {
                if let Some(args) = args {
                    let mut kind = COREWEBVIEW2_PROCESS_FAILED_KIND(0);
                    if args.ProcessFailedKind(&mut kind).is_ok()
                        && kind == COREWEBVIEW2_PROCESS_FAILED_KIND_RENDER_PROCESS_EXITED
                    {
                        log::warn!(
                            "WebView2 render process exited; reloading frontend (kind={kind:?})"
                        );
                        if let Err(error) = window_for_reload.eval("window.location.reload()") {
                            log::error!("WebView2 reload after crash failed: {error}");
                        }
                    }
                }
                Ok(())
            }));

            let mut token = Default::default();
            if let Err(error) = core.add_ProcessFailed(&handler, &mut token) {
                log::warn!("WebView2 ProcessFailed handler registration failed: {error}");
            }
        }
    });
}

#[cfg(not(windows))]
pub fn attach_webview_crash_recovery(_window: &tauri::WebviewWindow) {}
