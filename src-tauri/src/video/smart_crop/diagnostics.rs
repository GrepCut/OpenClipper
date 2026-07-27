use std::fmt;
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const FILE_NAME: &str = "open-clipper-face-action.log";

struct DiagnosticState {
    file: File,
    started: Instant,
    last_flush: Instant,
}

static STATE: OnceLock<Mutex<Option<DiagnosticState>>> = OnceLock::new();

fn state() -> &'static Mutex<Option<DiagnosticState>> {
    STATE.get_or_init(|| Mutex::new(None))
}

pub fn path() -> PathBuf {
    dirs::download_dir()
        .or_else(|| std::env::current_dir().ok())
        .unwrap_or_else(std::env::temp_dir)
        .join(FILE_NAME)
}

pub fn start(source: &str, start_time: f64, end_time: f64, tracking_enabled: bool) {
    let path = path();
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    let opened = OpenOptions::new()
        .create(true)
        .truncate(true)
        .write(true)
        .open(&path);
    let Ok(file) = opened else {
        return;
    };
    if let Ok(mut guard) = state().lock() {
        *guard = Some(DiagnosticState {
            file,
            started: Instant::now(),
            last_flush: Instant::now(),
        });
    }
    append(
        "run",
        &format!(
            "START version={} pid={} source={} range={start_time:.3}..{end_time:.3} tracking={} log={} resources={}",
            env!("CARGO_PKG_VERSION"),
            std::process::id(),
            source,
            tracking_enabled,
            path.display(),
            resource_snapshot(),
        ),
    );
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct ResourceSnapshot {
    pub working_set_mib: u64,
    pub peak_working_set_mib: u64,
    pub private_commit_mib: u64,
    pub pagefile_mib: u64,
    pub handles: u32,
    pub memory_load_pct: u32,
    pub physical_available_mib: u64,
    pub physical_total_mib: u64,
    pub virtual_available_mib: u64,
}

impl fmt::Display for ResourceSnapshot {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            formatter,
            "working_set_mib={} peak_working_set_mib={} private_commit_mib={} pagefile_mib={} handles={} memory_load_pct={} physical_available_mib={} physical_total_mib={} virtual_available_mib={}",
            self.working_set_mib,
            self.peak_working_set_mib,
            self.private_commit_mib,
            self.pagefile_mib,
            self.handles,
            self.memory_load_pct,
            self.physical_available_mib,
            self.physical_total_mib,
            self.virtual_available_mib,
        )
    }
}

pub fn resource_counters() -> Option<ResourceSnapshot> {
    #[cfg(windows)]
    {
        windows_resources::snapshot()
    }
    #[cfg(not(windows))]
    {
        None
    }
}

pub fn resource_snapshot() -> String {
    resource_counters()
        .map(|snapshot| snapshot.to_string())
        .unwrap_or_else(|| "resource-counters-unavailable".into())
}

pub fn append(stage: &str, message: &str) {
    append_impl(stage, message, false);
}

pub fn append_critical(stage: &str, message: &str) {
    append_impl(stage, message, true);
}

fn append_impl(stage: &str, message: &str, critical: bool) {
    let Ok(mut guard) = state().lock() else {
        return;
    };
    let Some(current) = guard.as_mut() else {
        return;
    };
    let elapsed_ms = current.started.elapsed().as_millis();
    let _ = writeln!(
        current.file,
        "[{}][+{elapsed_ms:>8}ms][{:?}][{stage}] {message}",
        chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f"),
        std::thread::current().id(),
    );
    if critical || current.last_flush.elapsed() >= Duration::from_secs(1) {
        let _ = current.file.flush();
        current.last_flush = Instant::now();
    }
}

pub fn finish(message: &str) {
    append_critical("run", message);
}

#[cfg(windows)]
mod windows_resources {
    use std::mem::{size_of, MaybeUninit};

    use windows::Win32::System::ProcessStatus::{
        GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows::Win32::System::SystemInformation::{GlobalMemoryStatusEx, MEMORYSTATUSEX};
    use windows::Win32::System::Threading::{GetCurrentProcess, GetProcessHandleCount};

    use super::ResourceSnapshot;

    fn mib(bytes: usize) -> u64 {
        (bytes / (1024 * 1024)) as u64
    }

    pub(super) fn snapshot() -> Option<ResourceSnapshot> {
        let mut process = MaybeUninit::<PROCESS_MEMORY_COUNTERS_EX>::zeroed();
        let process_ok = unsafe {
            GetProcessMemoryInfo(
                GetCurrentProcess(),
                process.as_mut_ptr().cast::<PROCESS_MEMORY_COUNTERS>(),
                size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
            )
            .is_ok()
        };
        let mut handles = 0u32;
        let handles_ok =
            unsafe { GetProcessHandleCount(GetCurrentProcess(), &mut handles).is_ok() };

        let mut system = MEMORYSTATUSEX {
            dwLength: size_of::<MEMORYSTATUSEX>() as u32,
            ..Default::default()
        };
        let system_ok = unsafe { GlobalMemoryStatusEx(&mut system).is_ok() };

        if !process_ok || !handles_ok || !system_ok {
            return None;
        }
        let process = unsafe { process.assume_init() };
        Some(ResourceSnapshot {
            working_set_mib: mib(process.WorkingSetSize),
            peak_working_set_mib: mib(process.PeakWorkingSetSize),
            private_commit_mib: mib(process.PrivateUsage),
            pagefile_mib: mib(process.PagefileUsage),
            handles,
            memory_load_pct: system.dwMemoryLoad,
            physical_available_mib: mib(system.ullAvailPhys as usize),
            physical_total_mib: mib(system.ullTotalPhys as usize),
            virtual_available_mib: mib(system.ullAvailVirtual as usize),
        })
    }
}
