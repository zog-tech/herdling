use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, STANDARD_NO_PAD};
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use zogsshd::config::{self, Device, Prefs};
use zogsshd::pair;
use zogsshd::rpc;
use zogsshd::serve::{http, ServeCtx};

const EXE: &str = "/home/sam/.local/bin/zogsshd";

/// A valid ed25519 public key blob: type string, then 32 key bytes of `fill`.
fn ed25519_blob(fill: u8) -> String {
    let mut b = vec![0, 0, 0, 11];
    b.extend_from_slice(b"ssh-ed25519");
    b.extend_from_slice(&[0, 0, 0, 32]);
    b.extend_from_slice(&[fill; 32]);
    STANDARD.encode(b)
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

struct Setup {
    dir: tempfile::TempDir,
    url: String,
    host_key_blob: String,
}

impl Setup {
    fn home(&self) -> &Path {
        self.dir.path()
    }
    fn cfg_dir(&self) -> PathBuf {
        self.home().join(".config/zogsshd")
    }
    fn config_path(&self) -> PathBuf {
        config::default_path(self.home())
    }
    fn keys_path(&self) -> PathBuf {
        self.home().join(".ssh/authorized_keys")
    }
    fn pair_json(&self) -> PathBuf {
        self.cfg_dir().join("pair.json")
    }
    fn keys(&self) -> String {
        std::fs::read_to_string(self.keys_path()).unwrap_or_default()
    }
    fn open(&self) -> String {
        pair::open_window(&self.cfg_dir(), now()).unwrap()
    }
}

/// Temp home with a host key, and the pairing HTTP server on port 0.
async fn start() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let host_key_blob = ed25519_blob(7);
    let host_key = dir.path().join("ssh_host_ed25519_key.pub");
    std::fs::write(&host_key, format!("ssh-ed25519 {host_key_blob} root@host\n")).unwrap();
    let ctx = ServeCtx {
        home: dir.path().into(),
        herdr_socket: dir.path().join("herdr.sock"),
        config_path: config::default_path(dir.path()),
        push_url: "http://127.0.0.1:9/unused".into(),
        debounce: Duration::from_millis(50),
        pair_port: Some(0),
        host_key_paths: vec![dir.path().join("missing.pub"), host_key],
        exe: PathBuf::from(EXE),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(http::serve(listener, http::State::new(&ctx)));
    Setup { dir, url: format!("http://{addr}/pair"), host_key_blob }
}

fn body(code: &str, key: &str, name: &str) -> Value {
    json!({"code": code, "device_id": "d1", "device_name": name, "host_id": "h_1",
           "public_key": key, "expo_token": "ExponentPushToken[test]"})
}

async fn post(s: &Setup, body: &Value) -> (u16, Value) {
    let r = reqwest::Client::new().post(&s.url).json(body).send().await.unwrap();
    let status = r.status().as_u16();
    (status, r.json().await.unwrap())
}

fn wrong(code: &str) -> String {
    let n: u32 = code.parse().unwrap();
    format!("{:06}", (n + 1) % 1_000_000)
}

#[tokio::test]
async fn pairs_with_right_code() {
    let s = start().await;
    let code = s.open();
    assert_eq!(code.len(), 6);
    assert!(code.bytes().all(|b| b.is_ascii_digit()));
    let blob = ed25519_blob(1);
    let (status, resp) = post(&s, &body(&code, &format!("ssh-ed25519 {blob} sam@phone"), "Sam iPhone")).await;
    assert_eq!(status, 200, "{resp}");

    let raw = STANDARD.decode(&s.host_key_blob).unwrap();
    let fp = format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(&raw)));
    assert_eq!(resp["host_key_fingerprint"], json!(fp));
    assert_eq!(resp["ssh_port"], json!(22));
    assert!(resp["host_name"].is_string());
    assert!(resp["user"].is_string());

    let expected = format!(
        "command=\"{EXE} rpc\",no-port-forwarding,no-X11-forwarding,no-agent-forwarding,no-pty ssh-ed25519 {blob} zogssh:Sam-iPhone\n"
    );
    assert_eq!(s.keys(), expected);

    let c = config::load(&s.config_path()).unwrap();
    assert_eq!(c.devices.len(), 1);
    let d = &c.devices[0];
    assert_eq!(d.id, "d1");
    assert_eq!(d.host_id, "h_1");
    assert_eq!(d.public_key.as_deref(), Some(format!("ssh-ed25519 {blob}").as_str()));
    assert_eq!(d.expo_token.as_deref(), Some("ExponentPushToken[test]"));
    assert_eq!(d.prefs, Prefs::default());
    assert!(!s.pair_json().exists());
}

#[tokio::test]
async fn files_are_private() {
    use std::os::unix::fs::PermissionsExt;
    let s = start().await;
    let code = s.open();
    let mode = |p: &Path| std::fs::metadata(p).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode(&s.pair_json()), 0o600);
    let (status, _) = post(&s, &body(&code, &format!("ssh-ed25519 {}", ed25519_blob(1)), "Sam")).await;
    assert_eq!(status, 200);
    assert_eq!(mode(&s.keys_path()), 0o600);
    assert_eq!(mode(&s.home().join(".ssh")), 0o700);
}

#[tokio::test]
async fn existing_authorized_keys_mode_is_kept() {
    use std::os::unix::fs::PermissionsExt;
    let s = start().await;
    std::fs::create_dir_all(s.home().join(".ssh")).unwrap();
    std::fs::write(s.keys_path(), "ssh-ed25519 AAAAother sam@laptop").unwrap();
    std::fs::set_permissions(s.keys_path(), std::fs::Permissions::from_mode(0o640)).unwrap();
    let code = s.open();
    let blob = ed25519_blob(1);
    let (status, _) = post(&s, &body(&code, &format!("ssh-ed25519 {blob}"), "Sam")).await;
    assert_eq!(status, 200);
    let mode = std::fs::metadata(s.keys_path()).unwrap().permissions().mode() & 0o777;
    assert_eq!(mode, 0o640);
    // A newline is added before the new line when the file did not end with one.
    let keys = s.keys();
    let lines: Vec<&str> = keys.lines().collect();
    assert_eq!(lines.len(), 2);
    assert_eq!(lines[0], "ssh-ed25519 AAAAother sam@laptop");
    assert!(lines[1].ends_with(&format!("ssh-ed25519 {blob} zogssh:Sam")));
}

#[tokio::test]
async fn wrong_code_rejected() {
    let s = start().await;
    let code = s.open();
    let before = std::fs::read(s.pair_json()).unwrap();
    let (status, resp) = post(&s, &body(&wrong(&code), &format!("ssh-ed25519 {}", ed25519_blob(1)), "Sam")).await;
    assert_eq!(status, 403);
    assert_eq!(resp, json!({"error": "bad_code"}));
    assert_eq!(s.keys(), "");
    assert!(config::load(&s.config_path()).unwrap().devices.is_empty());
    // The window is unchanged apart from the wrong-code counter.
    let (a, b): (Value, Value) =
        (serde_json::from_slice(&before).unwrap(), serde_json::from_slice(&std::fs::read(s.pair_json()).unwrap()).unwrap());
    assert_eq!(a["code"], b["code"]);
    assert_eq!(a["expires_at"], b["expires_at"]);
}

#[tokio::test]
async fn expired_window_rejected() {
    let s = start().await;
    let code = pair::open_window(&s.cfg_dir(), now() - 301).unwrap();
    let (status, resp) = post(&s, &body(&code, &format!("ssh-ed25519 {}", ed25519_blob(1)), "Sam")).await;
    assert_eq!(status, 410);
    assert_eq!(resp, json!({"error": "no_window"}));
    assert_eq!(s.keys(), "");
}

#[tokio::test]
async fn no_window_rejected() {
    let s = start().await;
    let (status, resp) = post(&s, &body("123456", &format!("ssh-ed25519 {}", ed25519_blob(1)), "Sam")).await;
    assert_eq!(status, 410);
    assert_eq!(resp, json!({"error": "no_window"}));
}

#[tokio::test]
async fn five_wrong_codes_close_window() {
    let s = start().await;
    let code = s.open();
    let key = format!("ssh-ed25519 {}", ed25519_blob(1));
    for i in 1..=pair::MAX_WRONG {
        let (status, resp) = post(&s, &body(&wrong(&code), &key, "Sam")).await;
        if i < pair::MAX_WRONG {
            assert_eq!((status, resp), (403, json!({"error": "bad_code"})), "attempt {i}");
        } else {
            assert_eq!((status, resp), (429, json!({"error": "too_many_attempts"})), "attempt {i}");
        }
    }
    assert!(!s.pair_json().exists());
    let (status, resp) = post(&s, &body(&code, &key, "Sam")).await;
    assert_eq!((status, resp), (410, json!({"error": "no_window"})));
    assert_eq!(s.keys(), "");
}

#[tokio::test]
async fn code_is_single_use() {
    let s = start().await;
    let code = s.open();
    let (status, _) = post(&s, &body(&code, &format!("ssh-ed25519 {}", ed25519_blob(1)), "Sam")).await;
    assert_eq!(status, 200);
    let (status, resp) = post(&s, &body(&code, &format!("ssh-ed25519 {}", ed25519_blob(2)), "Sam")).await;
    assert_eq!((status, resp), (410, json!({"error": "no_window"})));
    assert_eq!(s.keys().lines().count(), 1);
}

#[tokio::test]
async fn pair_rejects_injection() {
    let s = start().await;
    let code = s.open();
    let blob = ed25519_blob(1);
    let bad_keys = [
        "ssh-ed25519 AAAA\nssh-rsa BBBB".to_string(),
        "command=\"sh\" ssh-ed25519 AAAA".to_string(),
        format!("ssh-ed25519 {blob}\nssh-rsa BBBB"),
        format!("ssh-ed25519 {blob} ok\r\nssh-rsa BBBB"),
        format!("command=\"sh\" ssh-ed25519 {blob}"),
        format!(" ssh-ed25519 {blob}"),
        format!("ssh-rsa {blob}"),
        format!("ssh-ed25519  {blob}"),
        format!("ssh-ed25519 {blob}\""),
        format!("ssh-ed25519 {blob},no-pty"),
        "ssh-ed25519 AAAA".to_string(),
        "ssh-ed25519".to_string(),
        String::new(),
    ];
    for k in &bad_keys {
        let (status, resp) = post(&s, &body(&code, k, "Sam")).await;
        assert_eq!((status, resp), (400, json!({"error": "bad_request"})), "key {k:?}");
    }
    // Bad requests do not count as wrong codes and leave the window open.
    assert!(s.pair_json().exists());
    assert_eq!(s.keys(), "");

    let (status, resp) = post(&s, &body(&code, &format!("ssh-ed25519 {blob} a\"b,c"), "a\"b,c\nd")).await;
    assert_eq!(status, 200, "{resp}");
    let keys = s.keys();
    assert_eq!(keys.lines().count(), 1);
    let line = keys.lines().next().unwrap();
    assert!(line.ends_with(&format!("ssh-ed25519 {blob} zogssh:abcd")), "{line}");
    assert!(line.starts_with("command=\""));
}

#[tokio::test]
async fn bad_json_is_bad_request() {
    let s = start().await;
    s.open();
    let r = reqwest::Client::new().post(&s.url).body("{not json").send().await.unwrap();
    assert_eq!(r.status().as_u16(), 400);
    assert_eq!(r.json::<Value>().await.unwrap(), json!({"error": "bad_request"}));
    let big = "x".repeat(20 * 1024);
    let (status, resp) = post(&s, &body("123456", &format!("ssh-ed25519 {big}"), "Sam")).await;
    assert_eq!((status, resp), (400, json!({"error": "bad_request"})));
}

#[tokio::test]
async fn duplicate_key_not_appended_twice() {
    let s = start().await;
    let key = format!("ssh-ed25519 {}", ed25519_blob(1));
    for _ in 0..2 {
        let code = s.open();
        let (status, _) = post(&s, &body(&code, &key, "Sam iPhone")).await;
        assert_eq!(status, 200);
    }
    assert_eq!(s.keys().lines().count(), 1);
    assert_eq!(config::load(&s.config_path()).unwrap().devices.len(), 1);
}

async fn rpc_call(home: &Path, method: &str, params: Value) -> Value {
    let (mut client_tx, server_in) = tokio::io::duplex(65536);
    let (server_out, client_rx) = tokio::io::duplex(65536);
    let mut ctx = rpc::Ctx::new(home.join("none.sock"), home.into());
    ctx.config_path = config::default_path(home);
    ctx.authorized_keys = home.join(".ssh/authorized_keys");
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
    let req = json!({"id": 1, "method": method, "params": params});
    client_tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    serde_json::from_str(&lines.next_line().await.unwrap().unwrap()).unwrap()
}

#[tokio::test]
async fn revoke_removes_only_that_key() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let keys = home.join(".ssh/authorized_keys");
    std::fs::create_dir_all(keys.parent().unwrap()).unwrap();
    let (mine, other1, other2) = (ed25519_blob(1), ed25519_blob(2), ed25519_blob(3));
    let line_mine = pair::key_line(Path::new(EXE), &format!("ssh-ed25519 {mine}"), "Sam iPhone").unwrap();
    // Another line whose option text holds the blob must stay: only the key field counts.
    let first = format!("ssh-ed25519 {other1} sam@laptop\n");
    let third = format!("command=\"echo {mine}\" ssh-ed25519 {other2}   spaced comment \n");
    std::fs::write(&keys, format!("{first}{line_mine}\n{third}")).unwrap();
    config::update(&config::default_path(home), |c| {
        for id in ["d1", "d2"] {
            config::upsert_device(
                c,
                Device {
                    id: id.into(),
                    name: "Sam".into(),
                    host_id: "h_1".into(),
                    public_key: None,
                    expo_token: None,
                    prefs: Prefs::default(),
                },
            );
        }
    })
    .unwrap();

    let r = rpc_call(home, "pair.revoke", json!({"device_id": "d1", "public_key": format!("ssh-ed25519 {mine} x")})).await;
    assert_eq!(r["result"], json!({"removed_keys": 1, "removed_device": true}), "{r}");
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), format!("{first}{third}"));
    let c = config::load(&config::default_path(home)).unwrap();
    assert_eq!(c.devices.iter().map(|d| d.id.as_str()).collect::<Vec<_>>(), ["d2"]);

    let r = rpc_call(home, "pair.revoke", json!({"device_id": "d1", "public_key": format!("ssh-ed25519 {mine}")})).await;
    assert_eq!(r["result"], json!({"removed_keys": 0, "removed_device": false}));

    let r = rpc_call(home, "pair.revoke", json!({"device_id": "d2", "public_key": "ssh-ed25519 AAAA\nx"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
}

#[test]
fn append_and_remove_key_helpers() {
    let dir = tempfile::tempdir().unwrap();
    let keys = dir.path().join("nested/.ssh/authorized_keys");
    let blob = ed25519_blob(4);
    let line = pair::key_line(Path::new(EXE), &format!("ssh-ed25519 {blob}"), "").unwrap();
    assert!(line.ends_with(" zogssh:phone"));
    assert!(pair::append_key(&keys, &line).unwrap());
    assert!(!pair::append_key(&keys, &line).unwrap());
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), format!("{line}\n"));
    assert_eq!(pair::remove_key(&keys, &format!("ssh-ed25519 {blob}")).unwrap(), 1);
    assert_eq!(std::fs::read_to_string(&keys).unwrap(), "");
    assert_eq!(pair::remove_key(&dir.path().join("missing"), &format!("ssh-ed25519 {blob}")).unwrap(), 0);
}

#[test]
fn key_line_rejects_unsafe_exe() {
    let key = format!("ssh-ed25519 {}", ed25519_blob(1));
    assert!(pair::key_line(Path::new("/opt/a\"b/zogsshd"), &key, "Sam").is_err());
    assert!(pair::key_line(Path::new("/opt/a\nb/zogsshd"), &key, "Sam").is_err());
    assert!(pair::key_line(Path::new("relative/zogsshd"), &key, "Sam").is_err());
    assert!(pair::key_line(Path::new("/opt/a b/zogsshd"), &key, "Sam").is_err());
    assert!(pair::key_line(Path::new("/opt/$(id)/zogsshd"), &key, "Sam").is_err());
    assert!(pair::key_line(Path::new("/opt/`id`/zogsshd"), &key, "Sam").is_err());
    let long = "x".repeat(60);
    let line = pair::key_line(Path::new(EXE), &key, &long).unwrap();
    assert!(line.ends_with(&format!(" zogssh:{}", "x".repeat(40))));
}

#[test]
fn host_fingerprint_skips_unreadable() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(pair::host_fingerprint(&[dir.path().join("none.pub")]), None);
    let p = dir.path().join("k.pub");
    let blob = ed25519_blob(7);
    std::fs::write(&p, format!("ssh-ed25519 {blob}\n")).unwrap();
    let fp = format!("SHA256:{}", STANDARD_NO_PAD.encode(Sha256::digest(STANDARD.decode(&blob).unwrap())));
    assert_eq!(pair::host_fingerprint(&[dir.path().join("none.pub"), p]), Some(fp));
}

#[test]
fn pair_url_format() {
    assert_eq!(pair::pair_url("10.0.0.5", 7790, "123456"), "zogssh://pair?h=10.0.0.5&p=7790&c=123456");
}
