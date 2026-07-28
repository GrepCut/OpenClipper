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

pub fn main_window_is_visible(app: &tauri::AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|window| window.is_visible().ok())
        .unwrap_or(false)
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
