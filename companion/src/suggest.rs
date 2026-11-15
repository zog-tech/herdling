//! Suggested computers for `machines.suggest`: other computers that the user can add to the app.
//! Three sources: the machines that herdr-core knows (`machine.list`), the Host entries of
//! `~/.ssh/config` and the peers of `tailscale status --json`. The rules here are pure; `rpc.rs`
//! reads the sources. A suggestion holds only a name, an address, a user, a port and a state:
//! never a key, a key path or another value of the SSH config.

use serde::Serialize;
use serde_json::Value;

pub const CORE: &str = "core";
pub const SSH_CONFIG: &str = "ssh_config";
pub const TAILSCALE: &str = "tailscale";

/// The most bytes of `~/.ssh/config` that herdlingd reads.
pub const MAX_SSH_CONFIG: u64 = 256 * 1024;

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct Suggestion {
    pub name: String,
    /// A host name or an address that the phone can try.
    pub address: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
    /// Where the suggestion comes from: `core`, `ssh_config`, `tailscale`.
    pub sources: Vec<&'static str>,
    /// Tailscale: the peer is online. Core: the machine is connected. Missing when not known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub online: Option<bool>,
}

fn suggestion(name: &str, address: &str, user: Option<String>, port: Option<u16>, source: &'static str, online: Option<bool>) -> Suggestion {
    Suggestion { name: name.to_string(), address: address.to_string(), user, port, sources: vec![source], online }
}

/// A host name or an address: no spaces, no shell or path characters.
fn plain_host(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 253
        && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_' | ':' | '[' | ']' | '%'))
}

fn plain_user(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_'))
}

/// One SSH config line as a lower-case keyword and its value. `Key value`, `Key=value` and
/// `Key = value` are all valid. Quotes around the value go away.
fn keyword(line: &str) -> Option<(String, String)> {
    let line = line.trim();
    if line.is_empty() || line.starts_with('#') {
        return None;
    }
    let split = line.find(|c: char| c.is_whitespace() || c == '=')?;
    let (k, rest) = line.split_at(split);
    let v = rest.trim_start_matches(|c: char| c.is_whitespace() || c == '=').trim();
    Some((k.to_ascii_lowercase(), v.trim_matches('"').to_string()))
}

/// The real aliases of the `Host` entries. A pattern (`*`, `?`, `!`), a `Match` block, and an entry
/// that needs `ProxyJump` or `ProxyCommand` give nothing: the phone cannot use them.
pub fn from_ssh_config(text: &str) -> Vec<Suggestion> {
    struct Block {
        aliases: Vec<String>,
        host: Option<String>,
        user: Option<String>,
        port: Option<u16>,
        proxy: bool,
    }
    fn flush(b: Option<Block>, out: &mut Vec<Suggestion>) {
        let Some(b) = b else { return };
        if b.proxy {
            return;
        }
        for alias in &b.aliases {
            let address = b.host.clone().unwrap_or_else(|| alias.clone());
            if plain_host(&address) && plain_host(alias) {
                out.push(suggestion(alias, &address, b.user.clone(), b.port, SSH_CONFIG, None));
            }
        }
    }
    let mut out = Vec::new();
    // None: lines outside a usable Host block (the top, or a Match block).
    let mut cur: Option<Block> = None;
    for line in text.lines() {
        let Some((k, v)) = keyword(line) else { continue };
        match k.as_str() {
            "host" => {
                flush(cur.take(), &mut out);
                let aliases = v
                    .split_whitespace()
                    .map(|a| a.trim_matches('"').to_string())
                    .filter(|a| !a.contains(['*', '?', '!']))
                    .collect();
                cur = Some(Block { aliases, host: None, user: None, port: None, proxy: false });
            }
            "match" => flush(cur.take(), &mut out),
            _ => {
                let Some(b) = cur.as_mut() else { continue };
                // The first value wins, as in ssh.
                match k.as_str() {
                    "hostname" if b.host.is_none() => b.host = Some(v),
                    "user" if b.user.is_none() && plain_user(&v) => b.user = Some(v),
                    "port" if b.port.is_none() => b.port = v.parse().ok(),
                    "proxyjump" | "proxycommand" if !v.eq_ignore_ascii_case("none") => b.proxy = true,
                    _ => {}
                }
            }
        }
    }
    flush(cur, &mut out);
    out
}

/// The peers of `tailscale status --json`. The address is the MagicDNS name without the last dot,
/// else the first IPv4 address.
pub fn from_tailscale(status: &Value) -> Vec<Suggestion> {
    let Some(peers) = status.get("Peer").and_then(Value::as_object) else { return vec![] };
    let mut out: Vec<Suggestion> = peers
        .values()
        .filter_map(|p| {
            let name = p.get("HostName").and_then(Value::as_str).unwrap_or("");
            let dns = p.get("DNSName").and_then(Value::as_str).unwrap_or("").trim_end_matches('.');
            let ip = p
                .get("TailscaleIPs")
                .and_then(Value::as_array)
                .and_then(|ips| ips.iter().filter_map(Value::as_str).find(|ip| ip.contains('.')));
            let address = if dns.is_empty() { ip? } else { dns };
            let name = if name.is_empty() { address.split('.').next().unwrap_or(address) } else { name };
            (plain_host(address) && !name.trim().is_empty()).then(|| {
                suggestion(name.trim(), address, None, None, TAILSCALE, p.get("Online").and_then(Value::as_bool))
            })
        })
        .collect();
    out.sort_by_key(|s| s.name.to_lowercase());
    out
}

/// `[user@]host[:port]`. A bracketed IPv6 host keeps its brackets off.
pub fn parse_target(target: &str) -> (Option<String>, String, Option<u16>) {
    let target = target.trim().trim_start_matches("ssh://");
    let (user, rest) = match target.rsplit_once('@') {
        Some((u, r)) if plain_user(u) => (Some(u.to_string()), r),
        _ => (None, target),
    };
    if let Some(inner) = rest.strip_prefix('[') {
        if let Some((host, after)) = inner.split_once(']') {
            let port = after.strip_prefix(':').and_then(|p| p.parse().ok());
            return (user, host.to_string(), port);
        }
    }
    match rest.rsplit_once(':') {
        Some((h, p)) if !h.contains(':') => match p.parse() {
            Ok(port) => (user, h.to_string(), Some(port)),
            Err(_) => (user, rest.to_string(), None),
        },
        _ => (user, rest.to_string(), None),
    }
}

/// The machines of the core `machine.list` result. A `via` machine (reached by a command) gives
/// only its host name: the command is not an address.
pub fn from_core(result: &Value) -> Vec<Suggestion> {
    let Some(list) = result.get("machines").and_then(Value::as_array) else { return vec![] };
    list.iter()
        .filter_map(|m| {
            let name = m.get("name").and_then(Value::as_str)?;
            let host = m.get("host").and_then(Value::as_str).unwrap_or("");
            let via = m.get("via").and_then(Value::as_bool).unwrap_or(false);
            let (user, address, port) = match m.get("target").and_then(Value::as_str) {
                Some(t) if !via => parse_target(t),
                _ => (None, host.to_string(), None),
            };
            let online = m.get("state").and_then(Value::as_str).map(|s| s == "connected");
            plain_host(&address).then(|| suggestion(name, &address, user, port, CORE, online))
        })
        .collect()
}

/// One list from all sources, in source order. The same address (any case) is one suggestion:
/// the first name, user and port win, and the sources join. The computer itself (`own_names`,
/// its host names) is left out.
pub fn merge(lists: Vec<Vec<Suggestion>>, own_names: &[String]) -> Vec<Suggestion> {
    // The first label of a host name: `studio` for `studio.local` and `studio.example.ts.net`.
    let short = |s: &str| s.split('.').next().unwrap_or("").to_lowercase();
    let own: Vec<String> = own_names.iter().map(|n| short(n)).filter(|n| !n.is_empty()).collect();
    let is_own = |s: &Suggestion| {
        let a = s.address.to_lowercase();
        let ip = a.parse::<std::net::IpAddr>().is_ok();
        matches!(a.as_str(), "localhost" | "127.0.0.1" | "::1") || (!ip && own.contains(&short(&a)))
    };
    let mut out: Vec<Suggestion> = Vec::new();
    for s in lists.into_iter().flatten() {
        if is_own(&s) {
            continue;
        }
        match out.iter_mut().find(|o| o.address.eq_ignore_ascii_case(&s.address)) {
            Some(o) => {
                for src in s.sources {
                    if !o.sources.contains(&src) {
                        o.sources.push(src);
                    }
                }
                o.user = o.user.take().or(s.user);
                o.port = o.port.or(s.port);
                o.online = o.online.or(s.online);
            }
            None => out.push(s),
        }
    }
    out
}

/// The places where `tailscale` can be: each folder of `PATH`, the usual install folders, then
/// the macOS app. The first file that exists wins.
pub fn find_tailscale(path_var: Option<&str>) -> Option<std::path::PathBuf> {
    let mut dirs: Vec<std::path::PathBuf> = path_var.unwrap_or("").split(':').filter(|d| !d.is_empty()).map(Into::into).collect();
    dirs.extend(["/usr/local/bin", "/opt/homebrew/bin", "/usr/bin"].map(std::path::PathBuf::from));
    dirs.iter()
        .map(|d| d.join("tailscale"))
        .chain(std::iter::once("/Applications/Tailscale.app/Contents/MacOS/Tailscale".into()))
        .find(|p| p.is_file())
}

/// The longest wait for `tailscale status --json`.
pub const TAILSCALE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(3);

/// The peers from `<bin> status --json`. A missing program, a failure, a time-out or bad JSON
/// gives no peers.
pub async fn read_tailscale(bin: &std::path::Path, timeout: std::time::Duration) -> Vec<Suggestion> {
    let run = tokio::process::Command::new(bin)
        .args(["status", "--json"])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .kill_on_drop(true)
        .output();
    match tokio::time::timeout(timeout, run).await {
        Ok(Ok(out)) if out.status.success() => serde_json::from_slice(&out.stdout).map(|v| from_tailscale(&v)).unwrap_or_default(),
        _ => vec![],
    }
}

/// The Host entries of the SSH config at `path`. A missing or too large file gives none.
pub fn read_ssh_config(path: &std::path::Path) -> Vec<Suggestion> {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() && m.len() <= MAX_SSH_CONFIG => {
            std::fs::read_to_string(path).map(|t| from_ssh_config(&t)).unwrap_or_default()
        }
        _ => vec![],
    }
}
