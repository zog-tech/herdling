//! `ports.list`: the TCP ports that a process of this user listens on, for the browser preview.
//!
//! Only listeners on loopback (`127.0.0.0/8`, `::1`) or on all addresses (`0.0.0.0`, `::`) count.
//! macOS reads `lsof`; Linux reads `/proc/net/tcp`, `/proc/net/tcp6` and `/proc/<pid>/fd`.
//! Neither needs root. The ports of a pane's process tree come first.

use std::collections::{HashMap, HashSet};
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::transcript::procs::Proc;

/// How long a listener list stays fresh. `lsof` can take 1–2 s on some Macs.
pub const CACHE_TTL: Duration = Duration::from_secs(5);
/// Bound for one `lsof` run.
const LSOF_TIMEOUT: Duration = Duration::from_secs(10);

/// One listening TCP socket of this user.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Listener {
    pub port: u16,
    pub addr: IpAddr,
    /// The process that owns the socket, when known.
    pub pid: Option<u32>,
}

/// One item of the `ports.list` result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PortInfo {
    pub port: u16,
    pub addr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pid: Option<u32>,
    /// The process name, for example `node`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process: Option<String>,
    /// A short name of the program, for example `vite` for `node .../vite`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cmd: Option<String>,
    /// Set when the process descends from the shell of the asked pane.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pane_id: Option<String>,
}

/// The last listener list of this rpc process, see [`CACHE_TTL`].
#[derive(Clone, Default)]
pub struct PortsCache(Arc<Mutex<Option<Cached>>>);

/// A listener list and the time it was read.
type Cached = (Instant, Vec<Listener>);

impl PortsCache {
    /// The cached list when it is fresh, else a new one from `load`.
    pub fn get(&self, load: impl FnOnce() -> Vec<Listener>) -> Vec<Listener> {
        if let Some((at, list)) = self.0.lock().unwrap().as_ref() {
            if at.elapsed() < CACHE_TTL {
                return list.clone();
            }
        }
        self.refresh(load)
    }

    /// A new list from `load`, kept for the next calls.
    pub fn refresh(&self, load: impl FnOnce() -> Vec<Listener>) -> Vec<Listener> {
        let list = load();
        *self.0.lock().unwrap() = Some((Instant::now(), list.clone()));
        list
    }
}

/// True for a loopback address or for the wildcard address. An IPv4-mapped IPv6 address counts as its IPv4 address.
pub fn allowed_addr(a: &IpAddr) -> bool {
    match a {
        IpAddr::V4(v4) => v4.is_loopback() || v4.is_unspecified(),
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(v4) => v4.is_loopback() || v4.is_unspecified(),
            None => v6.is_loopback() || v6.is_unspecified(),
        },
    }
}

/// Parses `lsof -nP -iTCP -sTCP:LISTEN -F pcn` output. Lines start with a field letter:
/// `p` pid, `c` command, `f` file descriptor, `n` name (`127.0.0.1:5173`, `*:3000`, `[::1]:5173`).
pub fn parse_lsof(text: &str) -> Vec<Listener> {
    let mut out = Vec::new();
    let mut pid = None;
    for line in text.lines() {
        let Some(field) = line.chars().next() else { continue };
        let value = &line[field.len_utf8()..];
        match field {
            'p' => pid = value.parse::<u32>().ok(),
            'n' => {
                // A name never holds a space here; drop a state suffix if a version adds one.
                let name = value.split(' ').next().unwrap_or("");
                if let Some((addr, port)) = parse_lsof_name(name) {
                    out.push(Listener { port, addr, pid });
                }
            }
            _ => {}
        }
    }
    out
}

fn parse_lsof_name(name: &str) -> Option<(IpAddr, u16)> {
    // A connected socket has a "->" peer part. A listener does not.
    if name.contains("->") {
        return None;
    }
    let (host, port) = if let Some(rest) = name.strip_prefix('[') {
        let (h, p) = rest.split_once("]:")?;
        (IpAddr::V6(h.parse::<Ipv6Addr>().ok()?), p)
    } else {
        let (h, p) = name.rsplit_once(':')?;
        let addr = if h == "*" { IpAddr::V4(Ipv4Addr::UNSPECIFIED) } else { IpAddr::V4(h.parse::<Ipv4Addr>().ok()?) };
        (addr, p)
    };
    let port: u16 = port.parse().ok().filter(|p| *p != 0)?;
    Some((host, port))
}

/// Parses `/proc/net/tcp` (`v6` false) or `/proc/net/tcp6` (`v6` true). Returns the listening
/// sockets (state `0A`) of `uid` as (address, port, socket inode).
pub fn parse_proc_net_tcp(text: &str, v6: bool, uid: u32) -> Vec<(IpAddr, u16, u64)> {
    let mut out = Vec::new();
    for line in text.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 || cols[3] != "0A" {
            continue;
        }
        if cols[7].parse::<u32>().ok() != Some(uid) {
            continue;
        }
        let Some((addr, port)) = parse_hex_endpoint(cols[1], v6) else { continue };
        let Ok(inode) = cols[9].parse::<u64>() else { continue };
        if port != 0 {
            out.push((addr, port, inode));
        }
    }
    out
}

/// `0100007F:1435` or a 32-digit IPv6 form. The kernel prints each 32-bit word of the address
/// in host byte order, so the bytes come back with `to_ne_bytes`.
fn parse_hex_endpoint(s: &str, v6: bool) -> Option<(IpAddr, u16)> {
    let (addr, port) = s.split_once(':')?;
    let port = u16::from_str_radix(port, 16).ok()?;
    let word = |i: usize| -> Option<[u8; 4]> {
        let hex = addr.get(i * 8..i * 8 + 8)?;
        Some(u32::from_str_radix(hex, 16).ok()?.to_ne_bytes())
    };
    let ip = if v6 {
        if addr.len() != 32 {
            return None;
        }
        let mut b = [0u8; 16];
        for i in 0..4 {
            b[i * 4..i * 4 + 4].copy_from_slice(&word(i)?);
        }
        IpAddr::V6(Ipv6Addr::from(b))
    } else {
        if addr.len() != 8 {
            return None;
        }
        IpAddr::V4(Ipv4Addr::from(word(0)?))
    };
    Some((ip, port))
}

/// The socket inode from a `/proc/<pid>/fd/<n>` link target such as `socket:[12345]`.
pub fn socket_inode(link: &str) -> Option<u64> {
    link.strip_prefix("socket:[")?.strip_suffix(']')?.parse().ok()
}

/// The listeners of this user on this host. Blocks (it runs `lsof` or reads `/proc`).
pub fn host_listeners() -> Vec<Listener> {
    // SAFETY: getuid has no preconditions and cannot fail.
    let uid = unsafe { libc::getuid() };
    let all = if cfg!(target_os = "macos") { macos_listeners(uid) } else { linux_listeners(uid) };
    all.into_iter().filter(|l| allowed_addr(&l.addr)).collect()
}

fn macos_listeners(uid: u32) -> Vec<Listener> {
    let lsof = ["/usr/sbin/lsof", "/usr/bin/lsof"].into_iter().find(|p| std::path::Path::new(p).exists()).unwrap_or("lsof");
    let child = std::process::Command::new(lsof)
        .args(["-nP", "-iTCP", "-sTCP:LISTEN", "-a", "-u", &uid.to_string(), "-F", "pcn"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::null())
        .spawn();
    let Ok(mut child) = child else { return Vec::new() };
    // lsof can hang on a stale network mount: kill it after the bound.
    let deadline = Instant::now() + LSOF_TIMEOUT;
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(20)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                return Vec::new();
            }
        }
    }
    let mut text = String::new();
    if let Some(mut out) = child.stdout.take() {
        let _ = std::io::Read::read_to_string(&mut out, &mut text);
    }
    parse_lsof(&text)
}

fn linux_listeners(uid: u32) -> Vec<Listener> {
    let mut sockets = Vec::new();
    for (path, v6) in [("/proc/net/tcp", false), ("/proc/net/tcp6", true)] {
        if let Ok(text) = std::fs::read_to_string(path) {
            sockets.extend(parse_proc_net_tcp(&text, v6, uid));
        }
    }
    if sockets.is_empty() {
        return Vec::new();
    }
    let wanted: HashSet<u64> = sockets.iter().map(|s| s.2).collect();
    let mut owner: HashMap<u64, u32> = HashMap::new();
    if let Ok(dir) = std::fs::read_dir("/proc") {
        for entry in dir.flatten() {
            let Some(pid) = entry.file_name().to_str().and_then(|s| s.parse::<u32>().ok()) else { continue };
            // A process of another user gives "permission denied" here; skip it.
            let Ok(fds) = std::fs::read_dir(entry.path().join("fd")) else { continue };
            for fd in fds.flatten() {
                let Ok(target) = std::fs::read_link(fd.path()) else { continue };
                if let Some(inode) = target.to_str().and_then(socket_inode) {
                    if wanted.contains(&inode) {
                        owner.entry(inode).or_insert(pid);
                    }
                }
            }
        }
    }
    sockets.into_iter().map(|(addr, port, inode)| Listener { port, addr, pid: owner.get(&inode).copied() }).collect()
}

/// Interpreters whose program name is in the next command word.
const RUNNERS: &[&str] = &["node", "bun", "deno", "python", "python3", "ruby", "php", "java", "npx", "pnpm", "yarn", "npm", "uv", "uvx"];

/// A short program name for a process: the process name, or for an interpreter the file name
/// of the first command word that is not an option (`node .../vite` gives `vite`).
pub fn cmd_label(p: &Proc) -> Option<String> {
    let base = |s: &str| s.rsplit('/').next().unwrap_or(s).to_string();
    let name = base(&p.name);
    let is_runner = |n: &str| RUNNERS.contains(&n) || n.starts_with("python3.");
    if !is_runner(&name) {
        return (!name.is_empty()).then_some(name);
    }
    let mut words = p.cmd.iter().skip(1).filter(|w| !w.starts_with('-')).map(|w| base(w));
    let picked = words.find(|w| !w.is_empty() && !is_runner(w) && w != "run" && w != "exec");
    let strip = |w: String| [".js", ".mjs", ".cjs", ".py"].iter().find_map(|e| w.strip_suffix(e).map(String::from)).unwrap_or(w);
    Some(picked.map(strip).unwrap_or(name))
}

/// Every PID that descends from one of `roots`, the roots included.
pub fn descendants(procs: &[Proc], roots: &[u32]) -> HashSet<u32> {
    let mut kids: HashMap<u32, Vec<u32>> = HashMap::new();
    for p in procs {
        kids.entry(p.ppid).or_default().push(p.pid);
    }
    let mut seen: HashSet<u32> = roots.iter().copied().filter(|r| *r != 0).collect();
    let mut queue: Vec<u32> = seen.iter().copied().collect();
    while let Some(p) = queue.pop() {
        for k in kids.get(&p).into_iter().flatten() {
            if seen.insert(*k) {
                queue.push(*k);
            }
        }
    }
    seen
}

/// Builds the `ports.list` items: one per port, without `reserved` (the pairing port).
/// With `pane`, the ports of processes under the pane's roots get its id and come first.
pub fn build(listeners: &[Listener], procs: &[Proc], pane: Option<(&str, &[u32])>, reserved: u16) -> Vec<PortInfo> {
    let by_pid: HashMap<u32, &Proc> = procs.iter().map(|p| (p.pid, p)).collect();
    let tree = pane.map(|(_, roots)| descendants(procs, roots)).unwrap_or_default();
    let mut seen: HashMap<u16, usize> = HashMap::new();
    let mut out: Vec<PortInfo> = Vec::new();
    for l in listeners {
        if l.port == reserved || !allowed_addr(&l.addr) {
            continue;
        }
        let proc_ = l.pid.and_then(|p| by_pid.get(&p).copied());
        let item = PortInfo {
            port: l.port,
            addr: l.addr.to_string(),
            pid: l.pid,
            process: proc_.map(|p| p.name.clone()).filter(|n| !n.is_empty()),
            cmd: proc_.and_then(cmd_label),
            pane_id: match (pane, l.pid) {
                (Some((id, _)), Some(pid)) if tree.contains(&pid) => Some(id.to_string()),
                _ => None,
            },
        };
        match seen.get(&l.port) {
            // The same port on 127.0.0.1 and ::1: keep one item, the one that knows its process.
            Some(&i) if out[i].pid.is_none() && item.pid.is_some() => out[i] = item,
            Some(_) => {}
            None => {
                seen.insert(l.port, out.len());
                out.push(item);
            }
        }
    }
    out.sort_by_key(|p| (p.pane_id.is_none(), p.port));
    out
}

/// True when a process of this user listens on `port` on loopback or on all addresses.
pub fn is_listening(listeners: &[Listener], port: u16) -> bool {
    listeners.iter().any(|l| l.port == port && allowed_addr(&l.addr))
}
