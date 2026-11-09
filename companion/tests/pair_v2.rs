//! Pairing v2 over HTTP: `POST /pair/v2/start` and `POST /pair/v2/finish` (CPace).

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use curve25519_dalek::scalar::Scalar;
use herdlingd::config;
use herdlingd::cpace;
use herdlingd::pair;
use herdlingd::pair_v2::{self, hex, unhex, Session, Sessions};
use herdlingd::serve::{http, ServeCtx};
use serde_json::{json, Value};

const EXE: &str = "/home/sam/.local/bin/herdlingd";

fn ed25519_key(fill: u8) -> String {
    let mut b = vec![0, 0, 0, 11];
    b.extend_from_slice(b"ssh-ed25519");
    b.extend_from_slice(&[0, 0, 0, 32]);
    b.extend_from_slice(&[fill; 32]);
    format!("ssh-ed25519 {}", STANDARD.encode(b))
}

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_secs()
}

struct Setup {
    dir: tempfile::TempDir,
    base: String,
}

impl Setup {
    fn home(&self) -> &Path {
        self.dir.path()
    }
    fn cfg_dir(&self) -> PathBuf {
        self.home().join(".config/herdling")
    }
    fn keys(&self) -> String {
        std::fs::read_to_string(self.home().join(".ssh/authorized_keys")).unwrap_or_default()
    }
    fn open(&self) -> String {
        pair::open_window(&self.cfg_dir(), now()).unwrap()
    }
    fn window(&self) -> Option<Value> {
        std::fs::read(self.cfg_dir().join("pair.json")).ok().map(|b| serde_json::from_slice(&b).unwrap())
    }
    async fn post(&self, path: &str, body: &Value) -> (u16, Value) {
        let r = reqwest::Client::new().post(format!("{}{path}", self.base)).json(body).send().await.unwrap();
        let status = r.status().as_u16();
        (status, r.json().await.unwrap_or(Value::Null))
    }
}

async fn start() -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let host_key = dir.path().join("ssh_host_ed25519_key.pub");
    std::fs::write(&host_key, format!("{} root@host\n", ed25519_key(7))).unwrap();
    let ctx = ServeCtx {
        core_socket: None,
        home: dir.path().into(),
        herdr_socket: dir.path().join("herdr.sock"),
        config_path: config::default_path(dir.path()),
        push_url: "http://127.0.0.1:9/unused".into(),
        debounce: Duration::from_millis(50),
        pair_port: Some(0),
        host_key_paths: vec![host_key],
        exe: PathBuf::from(EXE),
    };
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(http::serve(listener, http::State::new(&ctx)));
    Setup { dir, base: format!("http://{addr}") }
}

/// The phone side of one exchange.
struct Phone {
    device_id: String,
    sid: [u8; 16],
    y: Scalar,
    ya: [u8; 32],
}

impl Phone {
    fn new(code: &str, seed: u8) -> Phone {
        let sid = [seed; 16];
        let (y, ya) = pair_v2::initiate(code, &sid, [seed.wrapping_add(1); 32]).unwrap();
        Phone { device_id: "d1".into(), sid, y, ya }
    }
    fn start_body(&self) -> Value {
        json!({"device_id": self.device_id, "sid": hex(&self.sid), "ya": hex(&self.ya)})
    }
    /// The finish body for `public_key`, with the tag over `tagged_key` (a relay changes one of them).
    fn finish_body(&self, start: &Value, public_key: &str, tagged_key: &str) -> (Value, [u8; 64], [u8; 64]) {
        let adb = unhex::<16>(start["session"].as_str().unwrap()).unwrap();
        let yb = unhex::<32>(start["yb"].as_str().unwrap()).unwrap();
        let ada = pair_v2::ada(&self.device_id);
        let key = pair_v2::initiator_mac_key(&self.y, &self.sid, &self.ya, &ada, &yb, &adb).unwrap();
        let tag_a = cpace::hmac_sha512(&key, &pair_v2::tag_a_msg(&self.ya, &ada, "Sam phone", "h_1", tagged_key));
        let body = json!({"session": start["session"], "device_name": "Sam phone", "host_id": "h_1",
                          "public_key": public_key, "tag_a": hex(&tag_a)});
        (body, key, tag_a)
    }
}

/// Runs start and finish. Returns the finish status and answer, and the phone's tag key and tag.
async fn pair_v2(s: &Setup, code: &str, seed: u8, public_key: &str, tagged_key: &str) -> (u16, Value, [u8; 64], [u8; 64], Value) {
    let phone = Phone::new(code, seed);
    let (status, started) = s.post("/pair/v2/start", &phone.start_body()).await;
    assert_eq!(status, 200, "{started}");
    let (body, key, tag_a) = phone.finish_body(&started, public_key, tagged_key);
    let (status, resp) = s.post("/pair/v2/finish", &body).await;
    (status, resp, key, tag_a, started)
}

fn wrong(code: &str) -> String {
    format!("{:06}", (code.parse::<u32>().unwrap() + 1) % 1_000_000)
}

#[tokio::test]
async fn right_code_pairs_and_the_host_proves_the_code() {
    let s = start().await;
    let code = s.open();
    let key = ed25519_key(1);
    let (status, resp, mac_key, tag_a, started) = pair_v2(&s, &code, 3, &key, &key).await;
    assert_eq!(status, 200, "{resp}");
    assert!(s.keys().contains(key.split(' ').nth(1).unwrap()));
    assert!(s.keys().contains("herdling:Sam-phone"));
    assert!(s.window().is_none(), "the window closes after a pairing");

    // The phone checks the host's tag over every field that it saves.
    let adb = unhex::<16>(started["session"].as_str().unwrap()).unwrap();
    let yb = unhex::<32>(started["yb"].as_str().unwrap()).unwrap();
    let fp = resp["host_key_fingerprint"].as_str();
    assert!(fp.is_some_and(|f| f.starts_with("SHA256:")));
    let port = u16::try_from(resp["ssh_port"].as_u64().unwrap()).unwrap();
    let msg = pair_v2::tag_b_msg(&yb, &adb, &tag_a, resp["host_name"].as_str().unwrap(), resp["user"].as_str().unwrap(), port, fp);
    let tag_b = unhex::<64>(resp["tag_b"].as_str().unwrap()).unwrap();
    assert!(cpace::hmac_verify(&mac_key, &msg, &tag_b));

    // `herdlingd pair` reads the note and does not ask to compare keys.
    assert_eq!(pair::take_checked(&s.cfg_dir()), Some(("d1".into(), key.clone())));
    assert_eq!(pair::take_checked(&s.cfg_dir()), None, "the note is read once");
}

#[tokio::test]
async fn wrong_code_fails_and_counts() {
    let s = start().await;
    let code = s.open();
    let key = ed25519_key(1);
    let (status, resp, ..) = pair_v2(&s, &wrong(&code), 3, &key, &key).await;
    assert_eq!((status, resp), (403, json!({"error": "bad_code"})));
    assert!(!s.keys().contains("herdling:"));
    let w = s.window().unwrap();
    assert_eq!((w["wrong"].as_u64(), w["started"].as_u64()), (Some(1), Some(0)));
    // The right code still works after one wrong try.
    let (status, ..) = pair_v2(&s, &code, 4, &key, &key).await;
    assert_eq!(status, 200);
}

#[tokio::test]
async fn relay_that_puts_in_its_own_key_fails() {
    let s = start().await;
    let code = s.open();
    let phone_key = ed25519_key(1);
    let relay_key = ed25519_key(9);
    // The relay forwards the phone's tag (made over the phone key) with its own key.
    let (status, resp, ..) = pair_v2(&s, &code, 3, &relay_key, &phone_key).await;
    assert_eq!((status, resp), (403, json!({"error": "bad_code"})));
    assert!(!s.keys().contains(relay_key.split(' ').nth(1).unwrap()));
    assert!(pair::take_checked(&s.cfg_dir()).is_none());
}

#[tokio::test]
async fn a_session_works_once() {
    let s = start().await;
    let code = s.open();
    let key = ed25519_key(1);
    let phone = Phone::new(&code, 3);
    let (_, started) = s.post("/pair/v2/start", &phone.start_body()).await;
    let (body, ..) = phone.finish_body(&started, &key, &key);
    assert_eq!(s.post("/pair/v2/finish", &body).await.0, 200);
    let (status, resp) = s.post("/pair/v2/finish", &body).await;
    assert_eq!((status, resp), (410, json!({"error": "no_session"})));
    let unknown = json!({"session": hex(&[0u8; 16]), "device_name": "x", "host_id": "h", "public_key": key, "tag_a": hex(&[0u8; 64])});
    assert_eq!(s.post("/pair/v2/finish", &unknown).await.0, 410);
}

#[tokio::test]
async fn each_start_holds_a_try() {
    let s = start().await;
    let code = s.open();
    for seed in 0..5u8 {
        let (status, _) = s.post("/pair/v2/start", &Phone::new(&wrong(&code), seed + 10).start_body()).await;
        assert_eq!(status, 200);
    }
    let (status, resp) = s.post("/pair/v2/start", &Phone::new(&code, 30).start_body()).await;
    assert_eq!((status, resp), (429, json!({"error": "too_many_attempts"})));
    // The v1 endpoint shares the budget.
    let v1 = json!({"code": code, "device_id": "d1", "device_name": "x", "host_id": "h_1",
                    "public_key": ed25519_key(1), "expo_token": null});
    assert_eq!(s.post("/pair", &v1).await.0, 429);
    assert!(!s.keys().contains("herdling:"));
}

#[tokio::test]
async fn bad_start_uses_no_try() {
    let s = start().await;
    s.open();
    let phone = Phone::new("000000", 3);
    let mut body = phone.start_body();
    for (field, value) in [("ya", hex(&[0u8; 32])), ("ya", "zz".into()), ("sid", "00".into()), ("device_id", String::new())] {
        let mut b = body.clone();
        b[field] = json!(value);
        assert_eq!(s.post("/pair/v2/start", &b).await.0, 400, "{field}={value}");
    }
    body["ya"] = json!(hex(&[0xffu8; 32]));
    assert_eq!(s.post("/pair/v2/start", &body).await.0, 400);
    let w = s.window().unwrap();
    assert_eq!((w["wrong"].as_u64(), w["started"].as_u64()), (Some(0), Some(0)));
}

#[tokio::test]
async fn malformed_finish_keeps_the_session() {
    let s = start().await;
    let code = s.open();
    let key = ed25519_key(1);
    let phone = Phone::new(&code, 3);
    let (_, started) = s.post("/pair/v2/start", &phone.start_body()).await;
    let (mut body, ..) = phone.finish_body(&started, &key, &key);
    let good = body.clone();
    body["public_key"] = json!("ssh-rsa AAAA");
    assert_eq!(s.post("/pair/v2/finish", &body).await.0, 400);
    assert_eq!(s.post("/pair/v2/finish", &good).await.0, 200);
}

#[tokio::test]
async fn new_window_ends_old_sessions() {
    let s = start().await;
    let code = s.open();
    let key = ed25519_key(1);
    let phone = Phone::new(&code, 3);
    let (_, started) = s.post("/pair/v2/start", &phone.start_body()).await;
    // The user runs herdlingd pair again: a new code.
    let new_code = s.open();
    let (body, ..) = phone.finish_body(&started, &key, &key);
    let (status, resp) = s.post("/pair/v2/finish", &body).await;
    assert_eq!((status, resp), (410, json!({"error": "no_window"})));
    assert!(!s.keys().contains("herdling:"));
    assert_eq!(s.window().unwrap()["code"].as_str(), Some(new_code.as_str()));
}

#[tokio::test]
async fn v1_still_pairs() {
    let s = start().await;
    let code = s.open();
    // One v2 start is open; v1 with the right code still works.
    s.post("/pair/v2/start", &Phone::new(&code, 3).start_body()).await;
    let v1 = json!({"code": code, "device_id": "d1", "device_name": "Old app", "host_id": "h_1",
                    "public_key": ed25519_key(1), "expo_token": null});
    let (status, resp) = s.post("/pair", &v1).await;
    assert_eq!(status, 200, "{resp}");
    assert!(resp.get("tag_b").is_none());
    assert!(s.keys().contains("herdling:Old-app"));
    assert!(pair::take_checked(&s.cfg_dir()).is_none(), "v1 leaves no note: herdlingd pair asks to compare keys");
}

fn session(id: u8, expires_at: u64) -> Session {
    Session {
        device_id: "d1".into(),
        code: "123456".into(),
        ya: [0; 32],
        ada: vec![],
        yb: [0; 32],
        adb: [id; 16],
        mac_key: [0; 64],
        expires_at,
    }
}

#[test]
fn sessions_expire_and_are_capped() {
    let mut t = Sessions::default();
    t.insert(session(1, 100));
    assert_eq!(t.device_id(&[1; 16], 99), Some("d1"));
    assert!(t.take(&[1; 16], 100).is_none(), "an expired session is gone");
    for i in 0..pair_v2::MAX_SESSIONS as u8 {
        t.insert(session(i, 200));
    }
    assert!(!t.has_room(150));
    assert!(t.has_room(200), "expired sessions free their room");
    assert!(t.is_empty());
}

#[test]
fn settle_try_counts_and_closes() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path();
    let code = pair::open_window(cfg, now()).unwrap();
    for _ in 0..pair::MAX_WRONG - 1 {
        assert_eq!(pair::reserve_try(cfg, now()).unwrap(), code);
        let r = pair::settle_try(cfg, &code, now(), false, || Ok::<(), ()>(()));
        assert_eq!(r, Err(pair::PairError::BadCode));
    }
    pair::reserve_try(cfg, now()).unwrap();
    let r = pair::settle_try(cfg, &code, now(), false, || Ok::<(), ()>(()));
    assert_eq!(r, Err(pair::PairError::TooManyAttempts));
    assert_eq!(pair::window_state(cfg, now()), pair::WindowState::Closed);
}

#[test]
fn failed_save_gives_the_try_back() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path();
    let code = pair::open_window(cfg, now()).unwrap();
    pair::reserve_try(cfg, now()).unwrap();
    assert_eq!(pair::settle_try(cfg, &code, now(), true, || Err::<(), _>("disk")), Ok(Err("disk")));
    let w: Value = serde_json::from_slice(&std::fs::read(pair::window_path(cfg)).unwrap()).unwrap();
    assert_eq!((w["wrong"].as_u64(), w["started"].as_u64()), (Some(0), Some(0)));
}

#[test]
fn expired_window_refuses_a_start() {
    let dir = tempfile::tempdir().unwrap();
    let cfg = dir.path();
    pair::open_window(cfg, 1000).unwrap();
    assert_eq!(pair::reserve_try(cfg, 1000 + pair::WINDOW.as_secs()), Err(pair::PairError::NoWindow));
}

#[test]
fn pair_url_asks_for_v2() {
    assert!(pair::pair_url("10.0.0.5", 7790, "123456", None).ends_with("&v=2"));
}
