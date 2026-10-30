//! `stats.get`: CPU and memory of the host, via `sysinfo`.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;

use sysinfo::{System, MINIMUM_CPU_UPDATE_INTERVAL};

use crate::types::Stats;

/// Reads the stats. CPU usage is a delta between two refreshes. The first call in a
/// process takes two, `MINIMUM_CPU_UPDATE_INTERVAL` apart. Later calls take one and
/// measure against the previous call. Blocks, so call it from `spawn_blocking`.
pub fn read(sys: &Mutex<System>, primed: &AtomicBool) -> Stats {
    let mut sys = sys.lock().unwrap_or_else(|e| e.into_inner());
    if !primed.swap(true, Ordering::SeqCst) {
        sys.refresh_cpu_usage();
        std::thread::sleep(MINIMUM_CPU_UPDATE_INTERVAL);
    }
    sys.refresh_cpu_usage();
    sys.refresh_memory();
    let total = sys.total_memory();
    let load = System::load_average();
    Stats {
        cpu_pct: sys.global_cpu_usage().clamp(0.0, 100.0),
        mem_used: total.saturating_sub(sys.available_memory()),
        mem_total: total,
        load: [load.one, load.five, load.fifteen],
        uptime_s: System::uptime(),
    }
}
