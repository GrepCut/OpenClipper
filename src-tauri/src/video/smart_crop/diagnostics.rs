use std::fmt;
pub fn start(_: &str, _: f64, _: f64, _: bool) {}

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

pub fn append(_: &str, _: &str) {}
pub fn append_critical(_: &str, _: &str) {}
pub fn finish(_: &str) {}

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
