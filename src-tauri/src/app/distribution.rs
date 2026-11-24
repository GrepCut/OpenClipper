#[cfg(windows)]
pub(crate) fn is_packaged() -> bool {
    use windows::Win32::Foundation::{APPMODEL_ERROR_NO_PACKAGE, ERROR_INSUFFICIENT_BUFFER};
    use windows::Win32::Storage::Packaging::Appx::GetCurrentPackageFullName;

    let mut length = 0;
    // A missing buffer makes Windows report whether the process has a package identity.
    match unsafe { GetCurrentPackageFullName(&mut length, None) } {
        ERROR_INSUFFICIENT_BUFFER => true,
        APPMODEL_ERROR_NO_PACKAGE => false,
        error => {
            log::warn!("Could not determine Windows package identity: {error:?}");
            false
        }
    }
}

#[cfg(not(windows))]
pub(crate) fn is_packaged() -> bool {
    false
}
