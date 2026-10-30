//! Bonjour (mDNS) advert so the phone finds this host on the LAN.

use anyhow::{Context, Result};
use mdns_sd::{ServiceDaemon, ServiceInfo};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tokio::process::Command;

pub const SERVICE_TYPE: &str = "_zogssh._tcp.local.";

pub struct AdvertInfo {
    pub host: String,
    pub user: String,
    pub ssh_port: u16,
    pub pair_port: u16,
    pub version: String,
    pub fingerprint: Option<String>,
}

/// TXT records of the advert. `fp` is left out when there is no fingerprint.
pub fn txt(info: &AdvertInfo) -> Vec<(String, String)> {
    let mut out = vec![
        ("host".to_string(), info.host.clone()),
        ("user".to_string(), info.user.clone()),
        ("ssh_port".to_string(), info.ssh_port.to_string()),
        ("ver".to_string(), info.version.clone()),
    ];
    if let Some(fp) = &info.fingerprint {
        out.push(("fp".to_string(), fp.clone()));
    }
    out
}

/// Removes NUL bytes. A NUL cannot go into an argv item.
fn clean(s: &str) -> String {
    s.replace('\0', "")
}

/// Picks the external advert program, or `None` to use the built-in mDNS responder.
/// The `mdns-sd` responder is invisible to the macOS system responder, so macOS uses `dns-sd`.
/// Values go as separate argv items and never through a shell.
pub fn advert_command(os: &str, has_avahi: bool, info: &AdvertInfo) -> Option<(String, Vec<String>)> {
    let pairs = txt(info).into_iter().map(|(k, v)| format!("{k}={}", clean(&v)));
    let name = clean(&info.host);
    let port = info.pair_port.to_string();
    match os {
        "macos" => {
            let mut args = vec!["-R".to_string(), name, "_zogssh._tcp".into(), "local".into(), port];
            args.extend(pairs);
            Some(("dns-sd".into(), args))
        }
        "linux" if has_avahi => {
            let mut args = vec![name, "_zogssh._tcp".to_string(), port];
            args.extend(pairs);
            Some(("avahi-publish-service".into(), args))
        }
        _ => None,
    }
}

fn on_path(program: &str) -> bool {
    std::env::var_os("PATH")
        .is_some_and(|paths| std::env::split_paths(&paths).any(|d| d.join(program).is_file()))
}

/// A running advert. Dropping it stops the advert.
pub enum Advert {
    /// Built-in responder.
    Mdns(ServiceDaemon),
    /// Supervisor task that keeps a system advert child alive. The child dies with the task.
    Process(tokio::task::JoinHandle<()>),
}

impl Drop for Advert {
    fn drop(&mut self) {
        if let Advert::Process(task) = self {
            task.abort();
        }
    }
}

async fn supervise(program: String, args: Vec<String>) {
    let mut delay = Duration::from_secs(5);
    loop {
        let started = Instant::now();
        match Command::new(&program)
            .args(&args)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true)
            .spawn()
        {
            Ok(mut child) => {
                let status = child.wait().await;
                eprintln!("zogsshd serve: {program} exited ({status:?}); retrying in {}s", delay.as_secs());
            }
            Err(e) => eprintln!("zogsshd serve: cannot start {program}: {e}; retrying in {}s", delay.as_secs()),
        }
        if started.elapsed() > Duration::from_secs(120) {
            delay = Duration::from_secs(5);
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(60));
    }
}

fn advertise_mdns(info: &AdvertInfo) -> Result<ServiceDaemon> {
    let daemon = ServiceDaemon::new().context("start mDNS daemon")?;
    // The mDNS host label is a single DNS label, so cut a dotted host name at the first dot.
    let label = info.host.split('.').next().filter(|s| !s.is_empty()).unwrap_or("zogssh");
    let service = ServiceInfo::new(
        SERVICE_TYPE,
        &info.host,
        &format!("{label}.local."),
        "",
        info.pair_port,
        &txt(info)[..],
    )
    .context("build mDNS service")?
    .enable_addr_auto();
    daemon.register(service).context("register mDNS service")?;
    Ok(daemon)
}

/// Starts the advert through the system responder when one exists, else through `mdns-sd`.
/// The advert lasts as long as the returned value lives.
pub fn advertise(info: &AdvertInfo) -> Result<Advert> {
    let has_avahi = on_path("avahi-publish-service");
    if let (Some((program, args)), Ok(handle)) =
        (advert_command(std::env::consts::OS, has_avahi, info), tokio::runtime::Handle::try_current())
    {
        return Ok(Advert::Process(handle.spawn(supervise(program, args))));
    }
    advertise_mdns(info).map(Advert::Mdns)
}
