use crate::infra::{media_protocol, model_cache};
use tauri::Manager;
use tauri_plugin_opener::OpenerExt;

pub fn register(builder: tauri::Builder<tauri::Wry>) -> tauri::Builder<tauri::Wry> {
    builder
        .register_asynchronous_uri_scheme_protocol("grepcut-media", |_ctx, request, responder| {
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
                        let _ = webview
                            .app_handle()
                            .opener()
                            .open_url(url.as_str().to_string(), None::<String>);
                    }
                    is_local
                })
                .build(),
        )
}
