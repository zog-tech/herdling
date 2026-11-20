//! Device mirror through the rpc loop: `devices.list`, `mirror.start`, the mirror server rules
//! (token, Host, Origin), frames on the WebSocket, and `mirror.stop`. A fake `xcrun` stands in for
//! the simulator: it lists one booted iPhone and writes a fake JPEG as its screenshot.

use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::time::Duration;

use futures_util::StreamExt;
use herdlingd::mirror::devices::Tools;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::Message;

const UDID: &str = "269EBED9-ADE0-4AF4-9067-6B649B12BCCB";
const JPEG: &[u8] = b"\xff\xd8\xff\xe0fake-jpeg";

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(65536);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn call(&mut self, id: u64, method: &str, params: Value) -> Value {
        let line = json!({"id": id, "method": method, "params": params}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        loop {
            let r: Value = serde_json::from_str(&self.rx.next_line().await.unwrap().unwrap()).unwrap();
            if r["id"] == id {
                return r;
            }
        }
    }
}

/// A fake `xcrun` script in `dir`.
fn fake_xcrun(dir: &Path) -> std::path::PathBuf {
    let img = dir.join("shot.bin");
    std::fs::write(&img, JPEG).unwrap();
    let list = json!({"devices": {"com.apple.CoreSimulator.SimRuntime.iOS-26-5": [
        {"udid": UDID, "name": "Demo iPhone", "state": "Booted", "isAvailable": true}
    ]}});
    let script = format!(
        "#!/bin/sh\nif [ \"$2\" = list ]; then echo '{list}'; exit 0; fi\n\
if [ \"$2\" = io ] && [ \"$4\" = screenshot ]; then cp '{img}' \"$6\"; exit 0; fi\nexit 1\n",
        img = img.display()
    );
    let p = dir.join("xcrun");
    std::fs::write(&p, script).unwrap();
    std::fs::set_permissions(&p, std::fs::Permissions::from_mode(0o755)).unwrap();
    p
}

fn ctx(dir: &Path) -> Ctx {
    let mut c = Ctx::new(dir.into());
    c.mirror.tools = Some(Tools { xcrun: Some(fake_xcrun(dir)), ..Default::default() });
    c
}

/// A plain HTTP GET; returns the status code.
async fn get(port: u16, path: &str, host: &str) -> u16 {
    let mut s = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
    s.write_all(format!("GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n").as_bytes()).await.unwrap();
    let mut out = Vec::new();
    s.read_to_end(&mut out).await.unwrap();
    let text = String::from_utf8_lossy(&out);
    text.split_whitespace().nth(1).unwrap().parse().unwrap()
}

#[tokio::test]
async fn devices_list_without_tools_is_empty() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(Ctx::new(dir.path().into()));
    let r = s.call(1, "devices.list", json!({})).await;
    assert_eq!(r["result"]["devices"], json!([]));
    assert_eq!(r["result"]["tools"]["adb"], false);
    let r = s.call(2, "mirror.start", json!({"device": format!("ios:{UDID}")})).await;
    assert_eq!(r["error"]["code"], "not_installed");
}

#[tokio::test]
async fn mirror_start_checks_its_params() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(ctx(dir.path()));
    for bad in [json!({}), json!({"device": "ios:../x"}), json!({"device": "android:a b"}), json!({"device": 5})] {
        let r = s.call(1, "mirror.start", bad.clone()).await;
        assert_eq!(r["error"]["code"], "bad_request", "{bad}");
    }
    let r = s.call(2, "mirror.start", json!({"device": "ios:11111111-2222-3333-4444-555555555555"})).await;
    assert_eq!(r["error"]["code"], "not_found");
    let r = s.call(3, "mirror.start", json!({"device": format!("ios:{UDID}"), "max_size": 10})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = s.call(4, "mirror.stop", json!({"device": format!("ios:{UDID}")})).await;
    assert_eq!(r["result"]["stopped"], false);
}

#[tokio::test]
async fn a_simulator_mirror_serves_the_page_and_screenshots() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(ctx(dir.path()));
    let id = format!("ios:{UDID}");

    let r = s.call(1, "devices.list", json!({})).await;
    assert_eq!(r["result"]["devices"][0]["id"], id);
    assert_eq!(r["result"]["devices"][0]["video"], false);
    assert_eq!(r["result"]["devices"][0]["input"], false);

    let r = s.call(2, "mirror.start", json!({"device": id})).await;
    let res = &r["result"];
    assert_eq!(res["source"], "screenshots", "{r}");
    assert_eq!(res["input"], false);
    let port = res["port"].as_u64().unwrap() as u16;
    let path = res["path"].as_str().unwrap().to_string();
    let grant = res["grant"].as_str().unwrap();
    assert!(herdlingd::proxy::valid_grant(grant));
    // The grant is in the grant file of the preview, for this port.
    let grants = std::fs::read_to_string(herdlingd::proxy::grants_path(dir.path())).unwrap();
    assert!(grants.contains(grant) && grants.contains(&format!("\"port\":{port}")));

    // A second start reuses the server.
    let again = s.call(3, "mirror.start", json!({"device": id})).await;
    assert_eq!(again["result"]["port"], port);
    assert_eq!(again["result"]["path"], path.as_str());

    let host = format!("localhost:{port}");
    assert_eq!(get(port, &path, &host).await, 200);
    assert_eq!(get(port, "/m/0123456789abcdef0123456789abcdef/", &host).await, 404);
    assert_eq!(get(port, "/", &host).await, 404);
    assert_eq!(get(port, &path, &format!("evil.test:{port}")).await, 403);

    // A WebSocket from another origin is refused.
    let url = format!("ws://{host}{path}ws?video=0");
    let mut bad = url.as_str().into_client_request().unwrap();
    bad.headers_mut().insert("Origin", "http://evil.test".parse().unwrap());
    assert!(tokio_tungstenite::connect_async(bad).await.is_err());

    let mut req = url.as_str().into_client_request().unwrap();
    req.headers_mut().insert("Origin", format!("http://{host}").parse().unwrap());
    let (mut ws, _) = tokio_tungstenite::connect_async(req).await.unwrap();
    let mut saw_state = false;
    let frame = tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            match ws.next().await.unwrap().unwrap() {
                Message::Text(t) => {
                    let v: Value = serde_json::from_str(t.as_str()).unwrap();
                    if v["type"] == "state" {
                        saw_state = true;
                        assert_eq!(v["platform"], "ios");
                        assert_eq!(v["source"], "screenshots");
                    }
                }
                Message::Binary(b) => break b,
                _ => {}
            }
        }
    })
    .await
    .expect("a frame in time");
    assert!(saw_state);
    assert_eq!(frame[0], 2, "a JPEG frame");
    assert_eq!(frame[1], 1, "a key frame");
    assert_eq!(&frame[2..], JPEG);

    let r = s.call(4, "devices.list", json!({})).await;
    assert_eq!(r["result"]["devices"][0]["mirroring"], true);

    let r = s.call(5, "mirror.stop", json!({"device": id})).await;
    assert_eq!(r["result"]["stopped"], true);
    // The viewer ends and the server closes.
    let end = tokio::time::timeout(Duration::from_secs(5), async {
        while let Some(Ok(m)) = ws.next().await {
            if m.is_close() {
                break;
            }
        }
    })
    .await;
    assert!(end.is_ok());
    tokio::time::sleep(Duration::from_millis(200)).await;
    assert!(tokio::net::TcpStream::connect(("127.0.0.1", port)).await.is_err());
}

#[test]
fn the_page_is_self_contained() {
    let page = herdlingd::mirror::server::PAGE;
    for bad in ["http://", "https://", "<script src", "<link", "@import"] {
        assert!(!page.contains(bad), "the page must not load {bad}");
    }
    assert!(page.contains("VideoDecoder"));
    assert!(herdlingd::mirror::server::CSP.starts_with("default-src 'none'"));
}

#[test]
fn host_and_origin_rules() {
    use herdlingd::mirror::server::{host_allowed, origin_allowed, same_token};
    for ok in ["localhost", "localhost:5173", "LOCALHOST:1", "127.0.0.1:80", "[::1]:8080", "[::1]"] {
        assert!(host_allowed(ok), "{ok}");
    }
    for bad in ["", "evil.test", "localhost.evil.test", "127.0.0.2:80", "localhost:0", "localhost:x", "[::2]:80", "[::1]x", "localhost:99999"] {
        assert!(!host_allowed(bad), "{bad}");
    }
    assert!(origin_allowed(Some("http://localhost:5173"), "localhost:5173"));
    assert!(!origin_allowed(Some("http://localhost:5174"), "localhost:5173"));
    assert!(!origin_allowed(None, "localhost:5173"));
    assert!(same_token("abc", "abc"));
    assert!(!same_token("abc", "abd"));
    assert!(!same_token("abc", "ab"));
}
