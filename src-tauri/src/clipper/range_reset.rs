use crate::infra::error::{DbError, DbResult};
use crate::storage::{
    export_cleanup::delete_project_exports,
    migrator::m002_shared_workspace::SHARED_WORKSPACE_OWNER_ID,
    repository::{ProjectRepository, RecordRepository},
};
use chrono::Utc;
use sea_orm::{DatabaseConnection, TransactionTrait};
use serde_json::Value;
use std::{fs, io, path::Path};

const STAGED_FILES: &str = ".range-reset";
const RESET_RECORD: &str = "clipper-range-reset";

fn read_directory(path: &Path) -> io::Result<Option<fs::ReadDir>> {
    match fs::symlink_metadata(path) {
        Ok(metadata) if metadata.is_dir() && path.canonicalize()? == path => {
            fs::read_dir(path).map(Some)
        }
        Ok(_) => Err(io::Error::other("Invalid range reset directory")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn stage_entries(data: &Path, staged: &Path, source: Option<&Path>) -> io::Result<()> {
    let entries = fs::read_dir(data)?.collect::<io::Result<Vec<_>>>()?;
    for entry in entries {
        let path = entry.path();
        let destination = staged.join(entry.file_name());
        match source {
            Some(source) if source == path => continue,
            Some(source) if source.starts_with(&path) => {
                if read_directory(&path)?.is_none() {
                    return Err(io::Error::other("Source directory is missing"));
                }
                fs::create_dir(&destination)?;
                stage_entries(&path, &destination, Some(source))?;
            }
            _ => fs::rename(path, destination)?,
        }
    }
    Ok(())
}

fn restore_entries(staged: &Path, data: &Path) -> io::Result<()> {
    if read_directory(data)?.is_none() {
        fs::create_dir(data)?;
    }
    let entries = fs::read_dir(staged)?.collect::<io::Result<Vec<_>>>()?;
    for entry in entries {
        let path = entry.path();
        let destination = data.join(entry.file_name());
        match fs::symlink_metadata(&destination) {
            Err(error) if error.kind() == io::ErrorKind::NotFound => fs::rename(path, destination)?,
            Err(error) => return Err(error),
            Ok(_) => {
                if read_directory(&path)?.is_none() {
                    return Err(io::Error::other("Staged range directory is missing"));
                }
                restore_entries(&path, &destination)?;
            }
        }
    }
    fs::remove_dir(staged)
}

pub(crate) fn has_staged_files(project: &Path) -> bool {
    fs::symlink_metadata(project.join(STAGED_FILES))
        .map_or_else(|error| error.kind() != io::ErrorKind::NotFound, |_| true)
}

async fn recover(
    database: &DatabaseConnection,
    projects_root: &Path,
    project_id: &str,
) -> Result<(), String> {
    if !has_staged_files(&projects_root.join(project_id)) {
        return Ok(());
    }
    let project = projects_root
        .canonicalize()
        .map_err(|e| e.to_string())?
        .join(project_id);
    let staged = project.join(STAGED_FILES);
    if read_directory(&project)
        .map_err(|e| e.to_string())?
        .is_none()
        || read_directory(&staged)
            .map_err(|e| e.to_string())?
            .is_none()
    {
        return Ok(());
    }

    let committed = RecordRepository::get(database, RESET_RECORD.into(), project_id.into())
        .await?
        .is_some();
    if committed {
        fs::remove_dir_all(&staged).map_err(|e| e.to_string())?;
        RecordRepository::delete(database, RESET_RECORD.into(), project_id.into()).await?;
    } else {
        restore_entries(&staged, &project.join("data")).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub(crate) async fn recover_all(database: &DatabaseConnection, root: &Path) -> Result<(), String> {
    let entries = match fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let mut result = Ok(());
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        if !entry.file_type().map_err(|e| e.to_string())?.is_dir() {
            continue;
        }
        if let Some(id) = entry.file_name().to_str() {
            if let Err(error) = recover(database, root, id).await {
                log::warn!("Could not recover range reset for {id}: {error}");
                result = Err(error);
            }
        }
    }
    result
}

async fn commit(
    database: &DatabaseConnection,
    project_id: &str,
    metadata: Value,
    staged: bool,
) -> DbResult<()> {
    let transaction = database.begin().await?;
    let owner = SHARED_WORKSPACE_OWNER_ID;
    let mut project = ProjectRepository::get(&transaction, project_id, owner)
        .await?
        .filter(|project| project["projectType"] == "clipper")
        .ok_or_else(|| DbError::message("Clipper project is unavailable"))?;
    project["metadata"] = metadata;
    project["updatedAt"] = Utc::now().to_rfc3339().into();
    ProjectRepository::put(&transaction, owner, project).await?;
    for namespace in [
        "clipper-pipeline-steps",
        "clipper-face-analysis",
        "clipper-range-words",
        "clipper-collage-regions",
    ] {
        RecordRepository::delete(&transaction, namespace.into(), project_id.into()).await?;
    }
    for mode in ["auto-parts", "ai", "manual"] {
        RecordRepository::delete(
            &transaction,
            "clipper-clips".into(),
            format!("{project_id}:{mode}"),
        )
        .await?;
    }
    delete_project_exports(&transaction, project_id).await?;
    if staged {
        RecordRepository::put(
            &transaction,
            RESET_RECORD.into(),
            project_id.into(),
            Some(project_id.into()),
            Value::Bool(true),
        )
        .await?;
    }
    transaction.commit().await?;
    Ok(())
}

pub(crate) async fn reset(
    database: &DatabaseConnection,
    projects_root: &Path,
    project_id: &str,
    active_source: Option<&Path>,
    metadata: Value,
) -> Result<(), String> {
    recover(database, projects_root, project_id).await?;
    let data = projects_root.join(project_id).join("data");
    let data_exists = match fs::symlink_metadata(&data) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    let staged = if data_exists {
        let root = projects_root.canonicalize().map_err(|e| e.to_string())?;
        let project = root.join(project_id);
        let data = project.join("data");
        if read_directory(&data).map_err(|e| e.to_string())?.is_none() {
            return Err("Project data directory is missing".into());
        }
        let source = active_source
            .map(Path::canonicalize)
            .transpose()
            .map_err(|e| e.to_string())?;
        // A committed marker can outlive its directory if the app quit during cleanup.
        RecordRepository::delete(database, RESET_RECORD.into(), project_id.into()).await?;
        let staged = project.join(STAGED_FILES);
        fs::create_dir(&staged).map_err(|e| e.to_string())?;
        if let Err(error) = stage_entries(&data, &staged, source.as_deref()) {
            return match recover(database, projects_root, project_id).await {
                Ok(()) => Err(error.to_string()),
                Err(recovery) => Err(format!("{error}; range recovery failed: {recovery}")),
            };
        }
        true
    } else {
        false
    };

    let result = commit(database, project_id, metadata, staged).await;
    match (result, recover(database, projects_root, project_id).await) {
        (Ok(()), recovery) => {
            if let Err(error) = recovery {
                log::warn!("Range reset committed; staged files will be cleaned on retry: {error}");
            }
            Ok(())
        }
        (Err(error), Ok(())) => Err(error.to_string()),
        (Err(error), Err(recovery)) => Err(format!("{error}; range recovery failed: {recovery}")),
    }
}
