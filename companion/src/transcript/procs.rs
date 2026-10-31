//! Find the agent process of a pane and its start time.

use std::collections::{HashMap, HashSet};
use std::time::{Duration, SystemTime};

use serde_json::Value;

/// One process of the host.
#[derive(Debug, Clone)]
pub struct Proc {
    pub pid: u32,
    pub ppid: u32,
    /// Process name, such as `codex` or `node`.
    pub name: String,
    /// Command line words.
    pub cmd: Vec<String>,
    pub start: SystemTime,
}

/// Source of the process list. Tests inject a fixed list.
pub type ProcList = fn() -> Vec<Proc>;

/// Every process of the host, via `sysinfo`. Blocks.
pub fn host_procs() -> Vec<Proc> {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};
    let mut sys = System::new();
    sys.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing().with_cmd(UpdateKind::Always),
    );
    sys.processes()
        .iter()
        .map(|(pid, p)| Proc {
            pid: pid.as_u32(),
            ppid: p.parent().map_or(0, |pp| pp.as_u32()),
            name: p.name().to_string_lossy().into_owned(),
            cmd: p.cmd().iter().map(|a| a.to_string_lossy().into_owned()).collect(),
            start: SystemTime::UNIX_EPOCH + Duration::from_secs(p.start_time()),
        })
        .collect()
}

/// PIDs from a herdr `pane.process_info` reply: the foreground processes (group leader first),
/// and the shell.
pub fn pane_pids(info: &Value) -> (Vec<u32>, Option<u32>) {
    let pid = |v: Option<&Value>| v.and_then(Value::as_u64).map(|n| n as u32);
    let mut fg: Vec<u32> = info
        .get("foreground_processes")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|p| pid(p.get("pid"))).collect())
        .unwrap_or_default();
    if let Some(g) = pid(info.get("foreground_process_group_id")) {
        fg.insert(0, g);
    }
    let mut seen = HashSet::new();
    fg.retain(|p| seen.insert(*p));
    (fg, pid(info.get("shell_pid")))
}

/// True when the process runs the program `bin`: by name, or by a command word whose
/// file name is `bin` (a Node script such as `/usr/local/bin/pi`).
fn runs(p: &Proc, bin: &str) -> bool {
    let base = |s: &str| s.rsplit('/').next().unwrap_or(s).to_string();
    base(&p.name) == bin || p.cmd.iter().take(3).any(|w| base(w) == bin)
}

/// Start time of the agent process in the pane. The search looks at the foreground processes,
/// then at every descendant of the shell and of the foreground processes, for a process that
/// runs one of `bins`. When none matches, the first foreground process that is not the shell
/// counts.
pub fn agent_start(procs: &[Proc], fg: &[u32], shell: Option<u32>, bins: &[&str]) -> Option<SystemTime> {
    let by_pid: HashMap<u32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs {
        kids.entry(p.ppid).or_default().push(p.pid);
    }
    let mut order: Vec<u32> = fg.to_vec();
    let mut queue: Vec<u32> = shell.into_iter().chain(fg.iter().copied()).collect();
    let mut seen: HashSet<u32> = queue.iter().copied().collect();
    while let Some(p) = queue.pop() {
        for k in kids.get(&p).into_iter().flatten() {
            if seen.insert(*k) {
                order.push(*k);
                queue.push(*k);
            }
        }
    }
    let hit = order.iter().filter_map(|p| by_pid.get(p)).find(|p| bins.iter().any(|b| runs(p, b)));
    hit.or_else(|| fg.iter().filter(|p| Some(**p) != shell).find_map(|p| by_pid.get(p)))
        .map(|p| p.start)
}
