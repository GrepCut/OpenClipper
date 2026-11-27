//! Recovery for range resets interrupted by an older build (the reset itself
//! was removed together with "Change source range"); runs once at startup.
use crate::storage::repository::RecordRepository;
use sea_orm::DatabaseConnection;
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
