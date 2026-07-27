use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Mutex, OnceLock};

use crate::video::smart_crop::diagnostics::{self, ResourceSnapshot};

const TREND_SAMPLES: usize = 129;
const WARMUP_OBSERVATIONS: u64 = 256;
const TREND_LIMIT_MIB: u64 = 512;
const PROCESS_EMERGENCY_MIB: u64 = 4 * 1024;
const AVAILABLE_EMERGENCY_MIB: u64 = 2 * 1024;
const SYSTEM_LOAD_EMERGENCY_PCT: u32 = 92;

static FORCE_CPU: AtomicBool = AtomicBool::new(false);
static TREND: OnceLock<Mutex<MemoryTrend>> = OnceLock::new();

#[derive(Default)]
struct MemoryTrend {
    private_commit_mib: VecDeque<u64>,
    observations: u64,
}

struct TrendObservation {
    count: u64,
    warmup_remaining: u64,
    growth_mib: Option<u64>,
}

impl MemoryTrend {
    fn reset(&mut self) {
        self.private_commit_mib.clear();
        self.observations = 0;
    }

    fn observe(&mut self, private_commit_mib: u64) -> TrendObservation {
        self.observations += 1;
        let warmup_remaining = WARMUP_OBSERVATIONS.saturating_sub(self.observations);
        if self.observations <= WARMUP_OBSERVATIONS {
            return TrendObservation {
                count: self.observations,
                warmup_remaining,
                growth_mib: None,
            };
        }
        self.private_commit_mib.push_back(private_commit_mib);
        while self.private_commit_mib.len() > TREND_SAMPLES {
            self.private_commit_mib.pop_front();
        }
        let growth_mib = (self.private_commit_mib.len() == TREND_SAMPLES)
            .then(|| {
                self.private_commit_mib
                    .front()
                    .and_then(|first| private_commit_mib.checked_sub(*first))
            })
            .flatten();
        TrendObservation {
            count: self.observations,
            warmup_remaining,
            growth_mib,
        }
    }
}

pub(super) fn reset(reason: &str) {
    if FORCE_CPU.load(Ordering::Acquire) {
        return;
    }
    if let Ok(mut trend) = TREND
        .get_or_init(|| Mutex::new(MemoryTrend::default()))
        .lock()
    {
        trend.reset();
    }
    diagnostics::append("winml-memory", &format!("trend reset reason={reason}"));
}

pub(super) fn fallback_requested() -> bool {
    FORCE_CPU.load(Ordering::Acquire)
}

pub(super) fn preflight() -> bool {
    if fallback_requested() {
        return true;
    }
    let Some(snapshot) = diagnostics::resource_counters() else {
        return false;
    };
    if is_emergency(snapshot) {
        request_fallback("system-memory-pressure", &format!("resources={snapshot}"));
    }
    fallback_requested()
}

pub(super) fn record_after_evaluation(trace: &str) -> bool {
    if fallback_requested() {
        return true;
    }
    let Some(snapshot) = diagnostics::resource_counters() else {
        return false;
    };
    if is_emergency(snapshot) {
        request_fallback(
            "system-memory-pressure",
            &format!("trace={trace} resources={snapshot}"),
        );
        return true;
    }
    let observation = TREND
        .get_or_init(|| Mutex::new(MemoryTrend::default()))
        .lock()
        .ok()
        .map(|mut trend| trend.observe(snapshot.private_commit_mib));
    if let Some(observation) = observation {
        if observation.count == 1
            || observation.count == WARMUP_OBSERVATIONS
            || observation.count % 64 == 0
        {
            diagnostics::append(
                "winml-memory",
                &format!(
                    "observation={} warmup_remaining={} window_growth_mib={:?} trace={trace} resources={snapshot}",
                    observation.count, observation.warmup_remaining, observation.growth_mib
                ),
            );
        }
        if let Some(growth_mib) = observation.growth_mib {
            if growth_mib > TREND_LIMIT_MIB {
                request_fallback(
                "sustained-private-commit-growth",
                &format!(
                    "trace={trace} samples={} growth_mib={growth_mib} limit_mib={TREND_LIMIT_MIB} resources={snapshot}",
                    TREND_SAMPLES
                ),
            );
            }
        }
    }
    fallback_requested()
}

pub(super) fn allocation_is_unsafe() -> bool {
    diagnostics::resource_counters().is_some_and(|snapshot| {
        snapshot.private_commit_mib > PROCESS_EMERGENCY_MIB
            && (snapshot.physical_available_mib < 512 || snapshot.memory_load_pct >= 98)
    })
}

fn is_emergency(snapshot: ResourceSnapshot) -> bool {
    snapshot.private_commit_mib > PROCESS_EMERGENCY_MIB
        && (snapshot.physical_available_mib < AVAILABLE_EMERGENCY_MIB
            || snapshot.memory_load_pct >= SYSTEM_LOAD_EMERGENCY_PCT)
}

fn request_fallback(reason: &str, details: &str) {
    if !FORCE_CPU.swap(true, Ordering::AcqRel) {
        diagnostics::append_critical(
            "winml-memory",
            &format!("forcing global fp32 CPU fallback reason={reason} {details}"),
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn snapshot(
        private_commit_mib: u64,
        physical_available_mib: u64,
        memory_load_pct: u32,
    ) -> ResourceSnapshot {
        ResourceSnapshot {
            private_commit_mib,
            physical_available_mib,
            memory_load_pct,
            ..ResourceSnapshot::default()
        }
    }

    #[test]
    fn stable_memory_does_not_trip_the_trend() {
        let mut trend = MemoryTrend::default();
        for index in 0..WARMUP_OBSERVATIONS as usize + TREND_SAMPLES {
            let growth = trend.observe(2_000 + (index % 8) as u64);
            if let Some(growth) = growth.growth_mib {
                assert!(growth <= 8);
            }
        }
    }

    #[test]
    fn sustained_growth_is_detected_after_the_full_window() {
        let mut trend = MemoryTrend::default();
        for index in 0..WARMUP_OBSERVATIONS {
            assert!(trend.observe(500 + index * 20).growth_mib.is_none());
        }
        let mut detected = None;
        for index in 0..TREND_SAMPLES {
            detected = trend.observe(2_000 + index as u64 * 8).growth_mib;
        }
        assert_eq!(detected, Some((TREND_SAMPLES as u64 - 1) * 8));
        assert!(detected.unwrap() > TREND_LIMIT_MIB);
    }

    #[test]
    fn reset_discards_an_initialization_jump() {
        let mut trend = MemoryTrend::default();
        for index in 0..64 {
            trend.observe(500 + index * 20);
        }
        trend.reset();
        for index in 0..WARMUP_OBSERVATIONS as usize + TREND_SAMPLES {
            let growth = trend.observe(3_000 + (index % 4) as u64);
            if let Some(growth) = growth.growth_mib {
                assert!(growth <= 4);
            }
        }
    }

    #[test]
    fn emergency_requires_high_process_commit_and_system_pressure() {
        assert!(is_emergency(snapshot(5_000, 1_500, 80)));
        assert!(is_emergency(snapshot(5_000, 3_000, 93)));
        assert!(!is_emergency(snapshot(3_000, 1_000, 95)));
        assert!(!is_emergency(snapshot(5_000, 3_000, 80)));
    }
}
