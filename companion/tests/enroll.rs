use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use zogsshd::config::{self, Device, Prefs};
use zogsshd::enroll::{self, EnrollCtx, INPUT_LIMIT};
use zogsshd::pair;

const EXE: &str = "/home/sam/.local/bin/zogsshd";

/// A valid ed25519 public key blob: type string, then 32 key bytes of `fill`.
fn ed25519_blob(fill: u8) -> String {
    let mut b = vec![0, 0, 0, 11];
    b.extend_from_slice(b"ssh-ed25519");
    b.extend_from_slice(&[0, 0, 0, 32]);
    b.extend_from_slice(&[fill; 32]);
    STANDARD.encode(b)
}

struct Setup {
    dir: tempfile::TempDir,
    ctx: EnrollCtx,
    host_key_blob: String,
}

impl Setup {
    fn keys(&self) -> String {
        std::fs::read_to_string(&self.ctx.authorized_keys).unwrap_or_default()
    }
    fn devices(&self) -> Vec<Device> {
        config::load(&self.ctx.config_path).unwrap().devices
    }
    /// Runs enroll with `input` and returns the parsed output line and the exit code.
    fn run(&self, input: &[u8]) -> (Value, i32) {
        let (line, code) = enroll::run(input, &self.ctx);
        assert!(!line.contains('\n'), "{line}");
        (serde_json::from_str(&line).unwrap(), code)
    }
    fn enroll(&self, device_id: &str, name: &str, key: &str) -> (Value, i32) {
        self.run(request(device_id, name, key).as_bytes())
    }
}

fn request(device_id: &str, name: &str, key: &str) -> String {
    json!({"device_id": device_id, "device_name": name, "host_id": "h_1", "public_key": key}).to_string() + "\n"
}

/// Temp home with a host key.
fn setup() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let host_key_blob = ed25519_blob(7);
    let host_key = dir.path().join("ssh_host_ed25519_key.pub");
    std::fs::write(&host_key, format!("ssh-ed25519 {host_key_blob} root@host\n")).unwrap();
    let ctx = EnrollCtx {
        authorized_keys: dir.path().join(".ssh/authorized_keys"),
        config_path: config::default_path(dir.path()),
        exe: PathBuf::from(EXE),
        host_key_paths: vec![dir.path().join("missing.pub"), host_key],
        host_name: "studio".into(),
    };
    Setup { dir, ctx, host_key_blob }
}

fn expected_line(blob: &str, name: &str) -> String {
    format!(
        "command=\"{EXE} rpc\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 {blob} zogssh:{name}\n"
    )
}

#[test]
fn enroll_appends_restricted_line() {
    let s = setup();
    let blob = ed25519_blob(1);
    let (out, code) = s.enroll("d_1", "Sam iPhone", &format!("ssh-ed25519 {blob} zogssh:Sam"));
    assert_eq!(code, 0, "{out}");
    assert_eq!(out["ok"], true);
    assert_eq!(s.keys(), expected_line(&blob, "Sam-iPhone"));
    let devices = s.devices();
    assert_eq!(
        devices,
        vec![Device {
            id: "d_1".into(),
            name: "Sam-iPhone".into(),
            host_id: "h_1".into(),
            public_key: Some(format!("ssh-ed25519 {blob}")),
            expo_token: None,
            prefs: Prefs::default(),
        }]
    );
    // The output never holds the key.
    assert!(!out.to_string().contains(&blob));
}

#[test]
fn enroll_is_idempotent() {
    let s = setup();
    let key = format!("ssh-ed25519 {}", ed25519_blob(1));
    assert_eq!(s.enroll("d_1", "Sam", &key).1, 0);
    assert_eq!(s.enroll("d_1", "Sam", &key).1, 0);
    assert_eq!(s.keys().lines().count(), 1);
    assert_eq!(s.devices().len(), 1);
}

#[test]
fn enroll_repair_replaces_old_key_line() {
    let s = setup();
    let old = ed25519_blob(1);
    let new = ed25519_blob(2);
    let mine = ed25519_blob(3);
    // A line the user added by hand stays, even for the old key.
    std::fs::create_dir_all(s.ctx.authorized_keys.parent().unwrap()).unwrap();
    std::fs::write(&s.ctx.authorized_keys, format!("ssh-ed25519 {mine} sam@laptop\nssh-ed25519 {old} sam@laptop\n")).unwrap();
    assert_eq!(s.enroll("d_1", "Sam", &format!("ssh-ed25519 {old}")).1, 0);
    // A push token saved through push.register survives a re-enroll.
    config::update(&s.ctx.config_path, |c| c.devices[0].expo_token = Some("ExponentPushToken[test]".into())).unwrap();

    let (out, code) = s.enroll("d_1", "Sam", &format!("ssh-ed25519 {new}"));
    assert_eq!(code, 0, "{out}");
    assert_eq!(s.keys(), format!("ssh-ed25519 {mine} sam@laptop\nssh-ed25519 {old} sam@laptop\n{}", expected_line(&new, "Sam")));
    let devices = s.devices();
    assert_eq!(devices.len(), 1);
    assert_eq!(devices[0].public_key.as_deref(), Some(format!("ssh-ed25519 {new}").as_str()));
    assert_eq!(devices[0].expo_token.as_deref(), Some("ExponentPushToken[test]"));
}

#[test]
fn enroll_rejects_injection() {
    let s = setup();
    let blob = ed25519_blob(1);
    std::fs::create_dir_all(s.ctx.authorized_keys.parent().unwrap()).unwrap();
    let before = "ssh-ed25519 AAAA sam@laptop\n";
    std::fs::write(&s.ctx.authorized_keys, before).unwrap();
    let bad_keys = [
        "ssh-ed25519 AAAA\nssh-rsa BBBB".to_string(),
        format!("ssh-ed25519 {blob}\nssh-rsa BBBB"),
        format!("ssh-ed25519 {blob} ok\r\nssh-rsa BBBB"),
        format!("command=\"sh\" ssh-ed25519 {blob}"),
        format!("no-pty ssh-ed25519 {blob}"),
        format!(" ssh-ed25519 {blob}"),
        format!("ssh-ed25519 {blob}\""),
        format!("ssh-ed25519 {blob},no-pty"),
        format!("ssh-rsa {blob}"),
        String::new(),
    ];
    for k in &bad_keys {
        let (out, code) = s.enroll("d_1", "Sam", k);
        assert_eq!((code, &out["ok"], &out["code"]), (1, &json!(false), &json!("bad_request")), "key {k:?}");
        assert!(!out.to_string().contains(&blob), "{out}");
    }
    for id in ["", "d\n1", &"d".repeat(129)] {
        let (out, code) = s.enroll(id, "Sam", &format!("ssh-ed25519 {blob}"));
        assert_eq!((code, &out["code"]), (1, &json!("bad_request")), "id {id:?}");
    }
    assert_eq!(s.keys(), before);
    assert!(s.devices().is_empty());

    // A name with a newline, quote, comma or option is sanitized like /pair does: one safe line.
    let (out, code) = s.enroll("d_1", "a\"b,c\nd command=\"sh\"", &format!("ssh-ed25519 {blob} a\"b,c"));
    assert_eq!(code, 0, "{out}");
    assert_eq!(s.keys(), format!("{before}{}", expected_line(&blob, "abcd-commandsh")));
}

#[test]
fn enroll_rejects_oversize_input() {
    let s = setup();
    let key = format!("ssh-ed25519 {}", ed25519_blob(1));
    let mut big = request("d_1", "Sam", &key).trim_end().to_string();
    big.insert_str(1, &format!("\"pad\":\"{}\",", "x".repeat(INPUT_LIMIT)));
    let (out, code) = s.run(big.as_bytes());
    assert_eq!((code, &out["code"]), (1, &json!("bad_request")), "{out}");
    assert_eq!(s.keys(), "");

    for junk in [&b"{not json"[..], b"", b"[]", b"{\"device_id\":\"d_1\"}"] {
        let (out, code) = s.run(junk);
        assert_eq!((code, &out["code"]), (1, &json!("bad_request")), "{out}");
    }
    assert_eq!(s.keys(), "");
    assert!(s.devices().is_empty());
}

#[test]
fn enroll_output_has_fingerprint() {
    let s = setup();
    let (out, code) = s.enroll("d_1", "Sam", &format!("ssh-ed25519 {}", ed25519_blob(1)));
    assert_eq!(code, 0);
    let raw = STANDARD.decode(&s.host_key_blob).unwrap();
    let fp = format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&raw)));
    assert_eq!(out, json!({"ok": true, "host_fingerprint": fp, "hostname": "studio"}));
    assert_eq!(pair::host_fingerprint(&s.ctx.host_key_paths).as_deref(), Some(fp.as_str()));
}

#[test]
fn enroll_reads_one_line_without_eof() {
    let s = setup();
    // The app cannot close stdin, so input after the first line is never read.
    let input = request("d_1", "Sam", &format!("ssh-ed25519 {}", ed25519_blob(1))) + "garbage that is not read";
    let (out, code) = s.run(input.as_bytes());
    assert_eq!(code, 0, "{out}");
}

#[test]
fn enroll_binary_prints_one_line() {
    let s = setup();
    let home: &Path = s.dir.path();
    let mut child = Command::new(env!("CARGO_BIN_EXE_zogsshd"))
        .arg("enroll")
        .env("HOME", home)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    use std::io::Write;
    child.stdin.take().unwrap().write_all(b"{bad\n").unwrap();
    let out = child.wait_with_output().unwrap();
    assert_eq!(out.status.code(), Some(1));
    let stdout = String::from_utf8(out.stdout).unwrap();
    assert_eq!(stdout.lines().count(), 1, "{stdout}");
    let v: Value = serde_json::from_str(stdout.trim()).unwrap();
    assert_eq!(v["code"], "bad_request");
    assert!(!home.join(".ssh").exists());
}
