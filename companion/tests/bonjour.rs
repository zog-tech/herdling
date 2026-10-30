use mdns_sd::{ServiceDaemon, ServiceEvent};
use std::time::{Duration, Instant};
use zogsshd::serve::bonjour::{advertise, txt, AdvertInfo, SERVICE_TYPE};

fn info(fp: Option<&str>) -> AdvertInfo {
    AdvertInfo {
        host: "mini".into(),
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
        pairs(&[("host", "mini"), ("user", "sam"), ("ssh_port", "22"), ("ver", "0.2.0"), ("fp", "SHA256:abc")])
    );
}

#[test]
fn txt_omits_missing_fp() {
    assert_eq!(txt(&info(None)), pairs(&[("host", "mini"), ("user", "sam"), ("ssh_port", "22"), ("ver", "0.2.0")]));
}

#[test]
#[ignore = "needs a multicast-capable network"]
fn advert_is_browsable() {
    let _advert = advertise(&info(None)).unwrap();
    let browser = ServiceDaemon::new().unwrap();
    let rx = browser.browse(SERVICE_TYPE).unwrap();
    let deadline = Instant::now() + Duration::from_secs(5);
    while let Some(left) = deadline.checked_duration_since(Instant::now()) {
        if let Ok(ServiceEvent::ServiceResolved(s)) = rx.recv_timeout(left) {
            if s.get_fullname().starts_with("mini.") {
                assert_eq!(s.get_property_val_str("user"), Some("sam"));
                return;
            }
        }
    }
    panic!("advert not resolved within 5 s");
}
