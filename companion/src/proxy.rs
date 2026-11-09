//! Browser preview: grants (`preview.open`, `preview.close`) and the proxy mode.
//!
//! The phone key cannot forward ports (`restrict` in its key line). For each TCP connection of
//! the preview, the app opens a new exec channel with the command `herdlingd proxy <port> <grant>`.
//! The forced command still runs `herdlingd rpc`; it reads that command from
//! `SSH_ORIGINAL_COMMAND` and becomes the proxy. The proxy connects only to a loopback address,
//! only with a live grant for the same port, and copies bytes both ways.
//!
//! Another user of the computer can listen on the same port on another loopback address (for
//! example `127.0.0.1` while the dev server of this user listens only on `::1`), or take the port
//! after the dev server stops. So `preview.open` records the address of the listener of this user
//! in the grant, and each proxy run checks again that a listener of this user is on that port and
//! address. The proxy connects only to that address. A grant with no listener is not renewed.
//!
//! The proxy runs in a new process, so grants go through a file (mode 0600, atomic rename).

use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr};
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use serde::{Deserialize, Serialize};
use tokio::io::{AsyncRead, AsyncWrite, AsyncWriteExt};
use tokio::net::TcpStream;

/// A grant lives this long after `preview.open` or after its last proxy connection.
pub const GRANT_TTL: Duration = Duration::from_secs(30 * 60);
/// At most this many live grants. A new grant drops the oldest one.
pub const MAX_GRANTS: usize = 16;
/// Characters in a grant: 128 random bits as lowercase hex.
pub const GRANT_LEN: usize = 32;
/// Bound for the TCP connect to the dev server.
pub const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
/// After the phone closes its side, the response can still drain for this long.
const DRAIN_TIMEOUT: Duration = Duration::from_secs(5);

/// One grant: the proxy may connect to `port` until `expires` (Unix seconds).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Grant {
    pub grant: String,
    pub port: u16,
    pub expires: u64,
    /// The loopback address to connect to, from the listener that `preview.open` found. A grant
    /// file of an older herdlingd has none: the first proxy run picks one and records it.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub addr: Option<IpAddr>,
}

#[derive(Debug, Default, Serialize, Deserialize)]
struct GrantFile {
    #[serde(default)]
    grants: Vec<Grant>,
}

/// Why the proxy refused a connection.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub enum Refusal {
    #[error("the grant is not 32 hex characters")]
    BadGrant,
    #[error("the port is not in the range 1-65535")]
    BadPort,
    #[error("the port is reserved for herdlingd")]
    Reserved,
    #[error("no live grant has this value")]
    NoGrant,
    #[error("the grant is for another port")]
    WrongPort,
    #[error("the grant file cannot be read or written: {0}")]
    Io(String),
    #[error("nothing listens on the port on loopback: {0}")]
    Connect(String),
    #[error("no listener of this user is on the port and address of the grant")]
    ListenerGone,
}

/// `~/.local/state/herdling/preview-grants.json`.
pub fn grants_path(home: &Path) -> PathBuf {
    home.join(".local/state/herdling/preview-grants.json")
}

/// True for exactly 32 lowercase hex characters.
pub fn valid_grant(s: &str) -> bool {
    s.len() == GRANT_LEN && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// A decimal port 1–65535: digits only, no sign, no leading zero.
pub fn parse_port(s: &str) -> Option<u16> {
    if s.is_empty() || s.len() > 5 || !s.bytes().all(|b| b.is_ascii_digit()) || s.starts_with('0') {
        return None;
    }
    s.parse::<u16>().ok().filter(|p| *p != 0)
}

/// A new random grant.
pub fn new_grant() -> String {
    let bytes: [u8; 16] = rand::random();
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// The proxy request in `SSH_ORIGINAL_COMMAND`: `<path>herdlingd proxy <port> <grant>`, split on
/// ASCII white space. The word before `proxy` must be `herdlingd` or end in `/herdlingd`.
/// Any other text gives `None`, and the caller runs the normal RPC loop. The text never goes to a shell.
pub fn parse_original_command(s: &str) -> Option<(u16, String)> {
    let words: Vec<&str> = s.split_ascii_whitespace().collect();
    let [.., exe, verb, port, grant] = words.as_slice() else { return None };
    if *verb != "proxy" || !(*exe == "herdlingd" || exe.ends_with("/herdlingd")) {
        return None;
    }
    let port = parse_port(port)?;
    valid_grant(grant).then(|| (port, (*grant).to_string()))
}

/// The loopback addresses that a listener can have, IPv4 first.
pub fn targets(port: u16) -> [SocketAddr; 2] {
    [SocketAddr::from((Ipv4Addr::LOCALHOST, port)), SocketAddr::from((Ipv6Addr::LOCALHOST, port))]
}

/// The loopback address that reaches a listener on `addr`: the address itself for loopback,
/// `127.0.0.1` for `0.0.0.0` and `::1` for `::`. An IPv4-mapped address counts as its IPv4
/// address. `None` for any other address.
pub fn connect_addr(addr: &IpAddr) -> Option<IpAddr> {
    let v4 = |a: Ipv4Addr| {
        if a.is_loopback() {
            Some(IpAddr::V4(a))
        } else if a.is_unspecified() {
            Some(IpAddr::V4(Ipv4Addr::LOCALHOST))
        } else {
            None
        }
    };
    match addr {
        IpAddr::V4(a) => v4(*a),
        IpAddr::V6(a) => match a.to_ipv4_mapped() {
            Some(m) => v4(m),
            None if a.is_loopback() || a.is_unspecified() => Some(IpAddr::V6(Ipv6Addr::LOCALHOST)),
            None => None,
        },
    }
}

/// The address to connect to for `port`, from the listeners of this user (`listeners` must hold
/// only listeners of this user). With `recorded`, a listener must still reach that address, else
/// `None`. Without it (a grant of an older herdlingd), the first listener on the port decides,
/// IPv4 first. Pure: the caller reads the listeners.
pub fn select_target(listeners: &[crate::ports::Listener], port: u16, recorded: Option<IpAddr>) -> Option<IpAddr> {
    let mut found: Vec<IpAddr> = listeners.iter().filter(|l| l.port == port).filter_map(|l| connect_addr(&l.addr)).collect();
    match recorded {
        Some(r) => found.contains(&r).then_some(r),
        None => {
            found.sort_by_key(IpAddr::is_ipv6);
            found.first().copied()
        }
    }
}

/// Connects to `addr`, which must be a loopback address.
pub async fn connect_to(addr: SocketAddr, timeout: Duration) -> std::io::Result<TcpStream> {
    if !addr.ip().is_loopback() {
        return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "not a loopback address"));
    }
    match tokio::time::timeout(timeout, TcpStream::connect(addr)).await {
        Ok(r) => r,
        Err(_) => Err(std::io::Error::new(std::io::ErrorKind::TimedOut, "connect timed out")),
    }
}

fn open_private(path: &Path, truncate: bool) -> std::io::Result<File> {
    OpenOptions::new().create(true).write(true).truncate(truncate).mode(0o600).open(path)
}

/// Reads the grant file under an exclusive lock, applies `f` to the live grants, and writes the
/// file back when `f` returns true in its pair. Expired grants are dropped.
fn with_grants<T>(path: &Path, now: u64, f: impl FnOnce(&mut Vec<Grant>) -> (T, bool)) -> std::io::Result<T> {
    let dir = path.parent().ok_or_else(|| std::io::Error::other("grant path has no parent"))?;
    fs::DirBuilder::new().recursive(true).mode(0o700).create(dir)?;
    let lock = open_private(&path.with_extension("json.lock"), false)?;
    fs4::fs_std::FileExt::lock_exclusive(&lock)?;
    let mut file: GrantFile = match fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => GrantFile::default(),
        Err(e) => return Err(e),
    };
    let before = file.grants.len();
    file.grants.retain(|g| g.expires > now && valid_grant(&g.grant));
    let (out, changed) = f(&mut file.grants);
    if changed || file.grants.len() != before {
        let tmp = path.with_extension(format!("json.tmp{}", std::process::id()));
        let mut w = open_private(&tmp, true)?;
        w.write_all(serde_json::to_string(&file).map_err(std::io::Error::other)?.as_bytes())?;
        w.sync_all()?;
        fs::rename(&tmp, path)?;
    }
    Ok(out)
}

/// Writes a new grant for `port` and the connect address `addr` (see [`select_target`]).
/// Drops the oldest grants above [`MAX_GRANTS`].
pub fn issue(path: &Path, port: u16, addr: Option<IpAddr>, now: u64) -> std::io::Result<Grant> {
    let g = Grant { grant: new_grant(), port, expires: now + GRANT_TTL.as_secs(), addr };
    with_grants(path, now, |grants| {
        grants.push(g.clone());
        grants.sort_by_key(|x| x.expires);
        let extra = grants.len().saturating_sub(MAX_GRANTS);
        grants.drain(..extra);
        ((), true)
    })?;
    Ok(g)
}

/// Removes a grant. Returns true when it was live.
pub fn revoke(path: &Path, grant: &str, now: u64) -> std::io::Result<bool> {
    with_grants(path, now, |grants| {
        let before = grants.len();
        grants.retain(|g| !same(&g.grant, grant));
        let removed = grants.len() != before;
        (removed, removed)
    })
}

/// Checks a proxy request against the grant file and the listeners of this user. Returns the
/// address to connect to and extends the grant's life. When no listener of this user reaches
/// the address of the grant, the grant is not renewed. `reserved` is the pairing port.
pub fn check(
    path: &Path,
    port: u16,
    grant: &str,
    reserved: u16,
    now: u64,
    listeners: &[crate::ports::Listener],
) -> Result<IpAddr, Refusal> {
    if !valid_grant(grant) {
        return Err(Refusal::BadGrant);
    }
    if port == 0 {
        return Err(Refusal::BadPort);
    }
    if port == reserved {
        return Err(Refusal::Reserved);
    }
    with_grants(path, now, |grants| match grants.iter_mut().find(|g| same(&g.grant, grant)) {
        None => (Err(Refusal::NoGrant), false),
        Some(g) if g.port != port => (Err(Refusal::WrongPort), false),
        Some(g) => match select_target(listeners, port, g.addr) {
            None => (Err(Refusal::ListenerGone), false),
            Some(addr) => {
                g.expires = now + GRANT_TTL.as_secs();
                g.addr = Some(addr);
                (Ok(addr), true)
            }
        },
    })
    .map_err(|e| Refusal::Io(e.to_string()))?
}

/// Compares two grants in a time that does not depend on where they differ.
fn same(a: &str, b: &str) -> bool {
    a.len() == b.len() && a.bytes().zip(b.bytes()).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

/// Reads the listeners of this user. Production: [`crate::ports::host_listeners`].
pub type ListenerSource = Arc<dyn Fn() -> Vec<crate::ports::Listener> + Send + Sync>;

/// Settings of one proxy run.
#[derive(Clone)]
pub struct ProxyCtx {
    pub grants_path: PathBuf,
    /// The pairing port of `serve`. It is never proxied.
    pub reserved: u16,
    pub connect_timeout: Duration,
    pub listeners: ListenerSource,
}

impl ProxyCtx {
    pub fn new(home: &Path, reserved: u16) -> ProxyCtx {
        ProxyCtx {
            grants_path: grants_path(home),
            reserved,
            connect_timeout: CONNECT_TIMEOUT,
            listeners: Arc::new(crate::ports::host_listeners),
        }
    }
}

/// Unix seconds now.
pub fn now_secs() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0, |d| d.as_secs())
}

/// Checks the grant and the listener, connects to the address of the grant and copies bytes
/// between `input`/`output` (the SSH channel) and the TCP connection until one side ends.
pub async fn run<R, W>(input: R, output: W, port: u16, grant: &str, ctx: &ProxyCtx) -> Result<(), Refusal>
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let (path, reserved, g, source) = (ctx.grants_path.clone(), ctx.reserved, grant.to_string(), ctx.listeners.clone());
    let addr = tokio::task::spawn_blocking(move || {
        // Check the request first: a bad request must not cost a listener read.
        if !valid_grant(&g) {
            return Err(Refusal::BadGrant);
        }
        check(&path, port, &g, reserved, now_secs(), &source())
    })
    .await
    .map_err(|e| Refusal::Io(e.to_string()))??;
    let tcp = connect_to(SocketAddr::new(addr, port), ctx.connect_timeout).await.map_err(|e| Refusal::Connect(e.to_string()))?;
    let _ = tcp.set_nodelay(true);
    pipe(input, output, tcp).await;
    Ok(())
}

/// Copies bytes both ways. When the dev server closes, the rest goes out and the copy ends.
/// When the channel closes, the response drains for a short time.
async fn pipe<R, W>(mut input: R, mut output: W, tcp: TcpStream)
where
    R: AsyncRead + Unpin,
    W: AsyncWrite + Unpin,
{
    let (mut tcp_r, mut tcp_w) = tcp.into_split();
    let down = async {
        let _ = tokio::io::copy(&mut tcp_r, &mut output).await;
        let _ = output.flush().await;
    };
    tokio::pin!(down);
    tokio::select! {
        _ = &mut down => {}
        _ = tokio::io::copy(&mut input, &mut tcp_w) => {
            let _ = tcp_w.shutdown().await;
            let _ = tokio::time::timeout(DRAIN_TIMEOUT, &mut down).await;
        }
    }
}
