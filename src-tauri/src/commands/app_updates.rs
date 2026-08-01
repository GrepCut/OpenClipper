use serde::Serialize;
use std::sync::Mutex;
use tauri::{ipc::Channel, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use url::Url;

const FALLBACK_UPDATER_ENDPOINT: &str =
    "https://api.grepcut.com/api/app-updates/check/{{target}}/{{arch}}/{{current_version}}?channel=stable&product=open-clipper";

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    version: String,
    current_version: String,
    date: Option<String>,
    body: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(tag = "event", content = "data")]
pub enum DownloadEvent {
    #[serde(rename_all = "camelCase")]
    Started {
        content_length: Option<u64>,
    },
    #[serde(rename_all = "camelCase")]
    Progress {
        chunk_length: usize,
    },
    Finished,
}

pub struct PendingUpdate(pub Mutex<Option<Update>>);

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_app_name() -> String {
    "Open Clipper".to_string()
}

#[tauri::command]
pub async fn check_for_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
) -> Result<Option<UpdateMetadata>, String> {
    let update = app
        .updater_builder()
        .endpoints(vec![updater_endpoint()?])
        .map_err(|error| error.to_string())?
        .pubkey(updater_pubkey()?)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;

    let metadata = update.as_ref().map(|update| UpdateMetadata {
        version: update.version.clone(),
        current_version: update.current_version.clone(),
        date: update.date.map(|date| date.to_string()),
        body: update.body.clone(),
    });

    *pending_update.0.lock().map_err(|error| error.to_string())? = update;

    Ok(metadata)
}

#[tauri::command]
pub async fn install_app_update(
    app: AppHandle,
    pending_update: State<'_, PendingUpdate>,
    on_event: Channel<DownloadEvent>,
) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let _ = &app;

    let Some(update) = pending_update
        .0
        .lock()
        .map_err(|error| error.to_string())?
        .take()
    else {
        return Err("There is no pending update to install".to_string());
    };

    let mut started = false;

    update
        .download_and_install(
            |chunk_length, content_length| {
                if !started {
                    let _ = on_event.send(DownloadEvent::Started { content_length });
                    started = true;
                }

                let _ = on_event.send(DownloadEvent::Progress { chunk_length });
            },
            || {
                let _ = on_event.send(DownloadEvent::Finished);
            },
        )
        .await
        .map_err(|error| error.to_string())?;

    #[cfg(not(target_os = "windows"))]
    app.restart();

    Ok(())
}

fn updater_endpoint() -> Result<Url, String> {
    let endpoint = option_env!("OPEN_CLIPPER_UPDATER_ENDPOINT")
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(FALLBACK_UPDATER_ENDPOINT)
        .to_string();

    Url::parse(&endpoint).map_err(|error| error.to_string())
}

fn updater_pubkey() -> Result<&'static str, String> {
    option_env!("OPEN_CLIPPER_UPDATER_PUBKEY")
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| {
            "Updater is not configured: OPEN_CLIPPER_UPDATER_PUBKEY is missing from the build environment."
                .to_string()
        })
}
