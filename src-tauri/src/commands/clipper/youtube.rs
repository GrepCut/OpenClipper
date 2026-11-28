use crate::video::jobs::registry::NativeJobRegistry;
use tauri::{AppHandle, State, WebviewWindow};

#[cfg(windows)]
use {
    crate::{
        clipper::{data::clipper_projects_root, youtube},
        storage::{
            database::LocalDb, migrator::m002_shared_workspace::SHARED_WORKSPACE_OWNER_ID,
            repository::project_repository::ProjectRepository,
        },
        video::jobs::registry::NativeJobEmitter,
    },
    std::{
        fs,
        path::{Path, PathBuf},
    },
    tauri::Manager,
};

#[tauri::command]
pub fn clipper_youtube_import_enabled() -> Option<&'static str> {
    #[cfg(windows)]
    return Some(youtube::VERSION);
    #[cfg(not(windows))]
    None
}

#[cfg(windows)]
fn secure_source_dir(app: &AppHandle, project_id: &str, create: bool) -> Result<PathBuf, String> {
    uuid::Uuid::parse_str(project_id)
        .ok()
        .filter(|id| id.to_string() == project_id)
        .ok_or("Invalid project id")?;
    let root = clipper_projects_root(app)?;
    if create {
        fs::create_dir_all(&root).map_err(|e| e.to_string())?;
    }
    let project = root.join(project_id);
    let directory = project.join("source");
    for path in [&project, &directory] {
        if create {
            match fs::create_dir(path) {
                Ok(()) => {}
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
                Err(e) => return Err(e.to_string()),
            }
        }
        match fs::symlink_metadata(path) {
            Ok(metadata) if metadata.is_dir() => {
                // Canonicalize to also reject Windows junctions.
                let actual = path.canonicalize().map_err(|e| e.to_string())?;
                let expected = root.canonicalize().map_err(|e| e.to_string())?.join(
                    path.strip_prefix(&root)
                        .map_err(|_| "Invalid project directory")?,
                );
                if actual != expected {
                    return Err("Invalid project directory".into());
                }
            }
            Ok(_) => return Err("Invalid project directory".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound && !create => break,
            Err(e) => return Err(e.to_string()),
        }
    }
    Ok(directory)
}

#[tauri::command]
pub fn start_clipper_youtube_import(
    app: AppHandle,
    webview: WebviewWindow,
    jobs: State<'_, NativeJobRegistry>,
    session_id: String,
    job_id: String,
    project_id: String,
    url: String,
    rights_confirmed: bool,
) -> Result<(), serde_json::Value> {
    #[cfg(not(windows))]
    {
        let _ = (
            app,
            webview,
            jobs,
            session_id,
            job_id,
            project_id,
            url,
            rights_confirmed,
        );
        Err("YouTube import is unavailable.".into())
    }
    #[cfg(windows)]
    {
        if !rights_confirmed {
            return Err("Confirm that you have the rights to import this video.".into());
        }
        let id = youtube::video_id(&url).map_err(|error| serde_json::json!(error))?;
        let cancelled = jobs.register_project_job(&session_id, &job_id, &project_id)?;
        let registry = jobs.inner().clone();
        let emitter = NativeJobEmitter::new(
            webview,
            session_id.clone(),
            job_id.clone(),
            cancelled.clone(),
        );
        tauri::async_runtime::spawn(async move {
            let result = async {
                let db = app.state::<LocalDb>();
                let project = ProjectRepository::get(
                    &db.database,
                    &project_id,
                    SHARED_WORKSPACE_OWNER_ID,
                )
                .await
                .ok()
                .flatten();
                if project.as_ref().and_then(|p| p["projectType"].as_str()) != Some("clipper") {
                    return Err(youtube::ImportError::new(
                        "project_missing",
                        "save",
                        "The Clipper project is unavailable.",
                    ));
                }
                youtube::check_cancel(&cancelled)?;
                let work = secure_source_dir(&app, &project_id, true).map_err(|_| {
                    youtube::ImportError::new(
                        "source_directory",
                        "save",
                        "Could not open the project folder.",
                    )
                })?;
                let downloads = app
                    .path()
                    .download_dir()
                    .ok()
                    .filter(|path| fs::create_dir_all(path).is_ok())
                    .ok_or(youtube::ImportError::new(
                        "downloads_directory",
                        "save",
                        "Could not open the Downloads folder.",
                    ))?;
                youtube::import(&work, &downloads, &id, &cancelled, |progress| {
                    let _ = emitter.progress(&progress);
                })
                .await
            }
            .await;
            registry.finish(&session_id, &job_id);
            match result {
                // A finished video belongs to the user and is never removed.
                Ok(video) => {
                    if emitter.result(&video).is_err() {
                        if let Err(cancel) = youtube::check_cancel(&cancelled) {
                            let _ = emitter.error(&cancel);
                        }
                    }
                }
                Err(error) => {
                    let _ = emitter.error(&error);
                }
            }
        });
        Ok(())
    }
}

#[cfg(windows)]
fn managed_name(name: &str, prefix: &str) -> bool {
    name.strip_prefix(prefix)
        .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok_and(|uuid| uuid.to_string() == id))
}

/// Removes partial downloads left behind by an interrupted import.
#[tauri::command]
pub async fn clean_clipper_youtube_sources(
    app: AppHandle,
    jobs: State<'_, NativeJobRegistry>,
    project_id: String,
) -> Result<(), String> {
    #[cfg(not(windows))]
    {
        let _ = (app, jobs, project_id);
        Ok(())
    }
    #[cfg(windows)]
    {
        let _block = jobs.block_project(&project_id, false).await?;
        let directory = secure_source_dir(&app, &project_id, false)?;
        clean_partial_downloads(&directory)
    }
}

#[cfg(windows)]
fn clean_partial_downloads(directory: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(directory) {
        Ok(entries) => entries,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name();
        let Some(name) = name.to_str() else { continue };
        let kind = entry.file_type().map_err(|e| e.to_string())?;
        if kind.is_dir() && managed_name(name, ".import-") {
            fs::remove_dir_all(path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;

    #[test]
    fn cleans_abandoned_downloads_and_keeps_videos() {
        let directory =
            std::env::temp_dir().join(format!("clipper-source-cleanup-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let active = directory.join(format!("youtube-{}.mp4", uuid::Uuid::new_v4()));
        let stale = directory.join(format!("youtube-{}.mp4", uuid::Uuid::new_v4()));
        let partial = directory.join(format!(".import-{}", uuid::Uuid::new_v4()));
        let unmanaged = directory.join("user-video.mp4");
        for file in [&active, &stale, &unmanaged] {
            fs::write(file, b"fixture").unwrap();
        }
        fs::create_dir(&partial).unwrap();
        fs::write(partial.join("partial.mp4"), b"fixture").unwrap();
        let result = clean_partial_downloads(&directory);
        let status = (
            active.is_file(),
            stale.exists(),
            partial.exists(),
            unmanaged.is_file(),
        );
        fs::remove_dir_all(directory).unwrap();
        result.unwrap();
        assert_eq!(status, (true, true, false, true));
    }
}
