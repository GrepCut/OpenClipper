use std::path::{Component, Path, PathBuf};

use tauri::{AppHandle, Manager};

pub(crate) fn app_test_root(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("test-datasets"))
}

pub(crate) fn test_dataset_root(app: &AppHandle, dataset_id: &str) -> Result<PathBuf, String> {
    validate_id(dataset_id)?;
    Ok(app_test_root(app)?.join(dataset_id))
}

pub(crate) fn test_clip_dir(
    app: &AppHandle,
    dataset_id: &str,
    clip_id: &str,
) -> Result<PathBuf, String> {
    validate_id(clip_id)?;
    Ok(test_dataset_root(app, dataset_id)?
        .join("clips")
        .join(clip_id))
}

pub(crate) fn test_run_dir(
    app: &AppHandle,
    dataset_id: &str,
    run_id: &str,
) -> Result<PathBuf, String> {
    validate_id(run_id)?;
    Ok(test_dataset_root(app, dataset_id)?
        .join("runs")
        .join(run_id))
}

pub(crate) fn validate_id(id: &str) -> Result<(), String> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-' || ch == '_')
    {
        return Err("Invalid local test identifier.".into());
    }
    Ok(())
}

pub(crate) fn validate_relative_path(path: &str) -> Result<(), String> {
    let path = Path::new(path);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err("Invalid relative artifact path.".into());
    }
    Ok(())
}
