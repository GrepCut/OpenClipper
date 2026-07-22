use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use super::types::{SessionConfig, VisionModel};

static DEVICE_CACHE: OnceLock<Mutex<HashMap<VisionModel, SessionConfig>>> = OnceLock::new();

pub(super) fn device_cache() -> &'static Mutex<HashMap<VisionModel, SessionConfig>> {
    DEVICE_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}
