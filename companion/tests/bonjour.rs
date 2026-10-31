use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::time::{Duration, Instant};
use herdlingd::serve::bonjour::{advert_command, txt, AdvertInfo, SERVICE_TYPE};

fn info(fp: Option<&str>) -> AdvertInfo {
    AdvertInfo {
        host: "studio".into(),
        user: "sam".into(),
        ssh_port: 22,
        pair_port: 7790,
        version: "0.2.0".into(),
        fingerprint: fp.map(Into::into),
    }
}

fn pairs(v: &[(&str, &str)]) -> Vec<(String, String)> {
    v.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

#[test]
fn txt_has_all_fields() {
    assert_eq!(
        txt(&info(Some("SHA256:abc"))),
        pairs(&[("host", "studio"), ("user", "sam"), ("ssh_port", "22"), ("ver", "0.2.0"), ("fp", "SHA256:abc")])
    );
}

#[test]
fn txt_omits_missing_fp() {
    assert_eq!(txt(&info(None)), pairs(&[("host", "studio"), ("user", "sam"), ("ssh_port", "22"), ("ver", "0.2.0")]));
}

fn strs(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn macos_uses_dns_sd() {
    let (prog, args) = advert_command("macos", false, &info(Some("SHA256:abc"))).unwrap();
    assert_eq!(prog, "dns-sd");
    assert_eq!(
        args,
        strs(&["-R", "studio", "_herdling._tcp", "local", "7790", "host=studio", "user=sam", "ssh_port=22", "ver=0.2.0", "fp=SHA256:abc"])
    );
}

#[test]
fn dotted_host_is_cut_at_first_dot() {
    let mut i = info(None);
    i.host = "studio.local".into();
    let (_, args) = advert_command("macos", false, &i).unwrap();
    assert_eq!(args[1], "studio");
    assert!(args.contains(&"host=studio".to_string()));
    assert!(!args.iter().any(|a| a.contains("local") && a != "local"));
}

#[test]
fn fp_omitted_when_none() {
    let (_, args) = advert_command("macos", false, &info(None)).unwrap();
    assert!(!args.iter().any(|a| a.starts_with("fp=")));
}

#[test]
fn linux_with_avahi() {
    let (prog, args) = advert_command("linux", true, &info(None)).unwrap();
    assert_eq!(prog, "avahi-publish-service");
    assert_eq!(args, strs(&["studio", "_herdling._tcp", "7790", "host=studio", "user=sam", "ssh_port=22", "ver=0.2.0"]));
}

#[test]
fn linux_without_avahi_falls_back() {
    assert!(advert_command("linux", false, &info(None)).is_none());
    assert!(advert_command("windows", true, &info(None)).is_none());
}

#[test]
fn nul_is_stripped() {
    let mut i = info(None);
    i.user = "sa\0m".into();
    let (_, args) = advert_command("macos", false, &i).unwrap();
    assert!(args.contains(&"user=sam".to_string()));
    assert!(args.iter().all(|a| !a.contains('\0')));
}

/// Checks the built-in responder (the fallback path) directly.
#[test]
#[ignore = "needs a multicast-capable network"]
fn mdns_fallback_is_browsable() {
    // Outside a tokio runtime `advertise` always takes the mdns-sd path.
    let _advert = herdlingd::serve::bonjour::advertise(&info(None)).unwrap();
    let browser = ServiceDaemon::new().unwrap();
    let rx = browser.browse(SERVICE_TYPE).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        if let Ok(ServiceEvent::ServiceResolved(s)) = rx.recv_timeout(left) {
            if s.get_fullname().starts_with("studio.") {
                assert_eq!(s.get_property_val_str("user"), Some("sam"));
                return;
            }
        }
    }
    panic!("advert not resolved within 5 s");
}
