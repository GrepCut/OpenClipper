use windows::Win32::System::Com::{CoInitializeEx, CoUninitialize, COINIT_MULTITHREADED};

use super::error_util::winml_error;
use super::types::NativeVisionError;

pub(super) struct MtaApartment;

impl MtaApartment {
    pub(super) fn initialize() -> Result<Self, NativeVisionError> {
        unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) }
            .ok()
            .map_err(|error| {
                winml_error("cpu_session_failed", "MTA initialization failed", error)
            })?;
        Ok(Self)
    }
}

impl Drop for MtaApartment {
    fn drop(&mut self) {
        unsafe { CoUninitialize() };
    }
}
