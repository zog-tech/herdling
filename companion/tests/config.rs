use std::os::unix::fs::PermissionsExt;

use herdlingd::config::{self, Config, Device, Prefs};

fn device(id: &str, name: &str) -> Device {
    Device {
        id: id.into(),
        name: name.into(),
        host_id: "h_1".into(),
        public_key: None,
        expo_token: None,
        capabilities: vec![],
        prefs: Prefs::default(),
    }
}

#[test]
fn missing_file_is_default() {
    let dir = tempfile::tempdir().unwrap();
    let c = config::load(&dir.path().join("config.toml")).unwrap();
    assert_eq!(c, Config { devices: vec![], summary_command: None, tts_command: None, stt_command: None, pair_port: 7790, ssh_port: 22 });
}

#[test]
fn update_round_trip_and_mode() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("sub/config.toml");
    config::update(&p, |c| c.summary_command = Some(vec!["claude".into(), "-p".into()])).unwrap();
    assert_eq!(config::load(&p).unwrap().summary_command, Some(vec!["claude".into(), "-p".into()]));
    assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(std::fs::metadata(p.parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
}

#[test]
fn upsert_replaces_by_id() {
    let mut c = Config::default();
    config::upsert_device(&mut c, device("d1", "a"));
    config::upsert_device(&mut c, device("d1", "b"));
    assert_eq!(c.devices.len(), 1);
    assert_eq!(c.devices[0].name, "b");
}

#[test]
fn concurrent_updates_keep_both() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    let handles: Vec<_> = (0..20)
        .map(|i| {
            let p = p.clone();
            std::thread::spawn(move || {
                config::update(&p, |c| config::upsert_device(c, device(&format!("d{i}"), "x"))).unwrap();
            })
        })
        .collect();
    for h in handles {
        h.join().unwrap();
    }
    assert_eq!(config::load(&p).unwrap().devices.len(), 20);
    assert_eq!(std::fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn parse_error_does_not_leak_source() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    std::fs::write(&p, "pair_port = 1\nssh_port = \"sk-secret\n").unwrap();
    let msg = format!("{:#}", config::load(&p).unwrap_err());
    assert!(!msg.contains("sk-secret"), "{msg}");
    assert!(msg.contains("line 2"), "{msg}");
}

#[test]
fn prefs_without_quiet_at_desk_default_true() {
    let dir = tempfile::tempdir().unwrap();
    let p = dir.path().join("config.toml");
    std::fs::write(
        &p,
        "[[devices]]\nid = \"d1\"\nname = \"x\"\nhost_id = \"h_1\"\n\n[devices.prefs]\nfinished = true\nneeds_you = false\n",
    )
    .unwrap();
    let prefs = &config::load(&p).unwrap().devices[0].prefs;
    assert_eq!(prefs, &Prefs { finished: true, needs_you: false, quiet_at_desk: true });
}
