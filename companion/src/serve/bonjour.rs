//! Bonjour (mDNS) advert so the phone finds this host on the LAN.

use anyhow::{Context, Result};
use mdns_sd::{ServiceDaemon, ServiceInfo};

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

/// Starts the advert. The advert lasts as long as the returned daemon lives.
pub fn advertise(info: &AdvertInfo) -> Result<ServiceDaemon> {
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
