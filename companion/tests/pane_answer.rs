//! `pane.answer`: checks the menu on the computer, then sends one digit, or answers `stale`.

#[path = "support/fake_herdr.rs"]
mod fake_herdr;

use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use herdlingd::choices::short_label;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const MENU: &str = "╭────────────────────────────────╮\n\
                    │ Bash command                   │\n\
                    │ Do you want to proceed?        │\n\
                    │ ❯ 1. Yes                       │\n\
                    │   2. Yes, and don't ask again  │\n\
                    │   3. No, and tell Claude what to do differently (esc) │\n\
                    ╰────────────────────────────────╯";

type Sent = Arc<Mutex<Vec<(String, Value)>>>;

/// A fake herdr whose pane `w1:p1` has `status` and shows `screen`. Records every call.
fn fake(sock: &Path, status: &'static str, screen: &'static str) -> Sent {
    let sent: Sent = Arc::default();
    let log = sent.clone();
    fake_herdr::spawn_fn(sock, move |method, params| {
        log.lock().unwrap().push((method.to_string(), params.clone()));
        if params["pane_id"] != "w1:p1" {
            return None;
        }
        match method {
            "pane.get" => Some(json!({"type": "pane_get", "pane": {"pane_id": "w1:p1", "agent_status": status}})),
            "pane.read" => Some(json!({"type": "pane_read", "read": {"revision": 0, "text": screen}})),
            "pane.send_keys" => Some(json!({"type": "ok"})),
            _ => None,
        }
    });
    sent
}

async fn call(sock: &Path, home: &Path, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 16);
    let (server_out, client_rx) = tokio::io::duplex(1 << 16);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock.into(), home.into())));
    let req = json!({"id": 1, "method": "pane.answer", "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    let l = tokio::time::timeout(Duration::from_secs(10), lines.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&l).unwrap()
}

fn keys_sent(sent: &Sent) -> Vec<Value> {
    sent.lock().unwrap().iter().filter(|(m, _)| m == "pane.send_keys").map(|(_, p)| p.clone()).collect()
}

#[tokio::test]
async fn answers_when_the_menu_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "blocked", MENU);
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(keys_sent(&sent), [json!({"pane_id": "w1:p1", "keys": ["1"]})]);
    let read = sent.lock().unwrap().iter().find(|(m, _)| m == "pane.read").unwrap().1.clone();
    assert_eq!(read, json!({"pane_id": "w1:p1", "source": "visible", "format": "text"}));
    assert!(herdlingd::phone_input::last(dir.path(), "w1:p1").is_some(), "the answer is phone input");
}

#[tokio::test]
async fn accepts_the_cut_label_of_a_push() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let screen: &'static str = Box::leak(
        format!("❯ 1. Yes\n  2. No, and tell Claude what to do differently because {}", "x".repeat(40)).into_boxed_str(),
    );
    let sent = fake(&sock, "blocked", screen);
    let full = herdlingd::choices::parse_choices(screen)[1].label.clone();
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "2", "expect_label": short_label(&full)})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(keys_sent(&sent).len(), 1);
}

#[tokio::test]
async fn stale_when_the_label_changed() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "blocked", MENU);
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "3", "expect_label": "No"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
    assert_eq!(herdlingd::phone_input::last(dir.path(), "w1:p1"), None);
}

#[tokio::test]
async fn stale_when_there_is_no_menu() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "blocked", "> \n  ? for shortcuts");
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_key_is_not_in_the_menu() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "blocked", MENU);
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "4", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_agent_no_longer_waits() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "working", MENU);
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_pane_is_gone() {
    // herdr answers `pane_not_found` to every call.
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let listener = tokio::net::UnixListener::bind(&sock).unwrap();
    tokio::spawn(async move {
        while let Ok((stream, _)) = listener.accept().await {
            let (r, mut w) = stream.into_split();
            let mut lines = BufReader::new(r).lines();
            if let Ok(Some(line)) = lines.next_line().await {
                let req: Value = serde_json::from_str(&line).unwrap();
                let e = json!({"id": req["id"], "error": {"code": "pane_not_found", "message": "no such pane"}});
                let _ = w.write_all(format!("{e}\n").as_bytes()).await;
            }
        }
    });
    let r = call(&sock, dir.path(), json!({"pane_id": "w1:p1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
}

#[tokio::test]
async fn rejects_bad_params() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("herdr.sock");
    let sent = fake(&sock, "blocked", MENU);
    for p in [
        json!({"pane_id": "w1:p1", "key": "1"}),
        json!({"pane_id": "w1:p1", "expect_label": "Yes"}),
        json!({"key": "1", "expect_label": "Yes"}),
        json!({"pane_id": "", "key": "1", "expect_label": "Yes"}),
        json!({"pane_id": "w1:p1", "key": "0", "expect_label": "Yes"}),
        json!({"pane_id": "w1:p1", "key": "12", "expect_label": "Yes"}),
        json!({"pane_id": "w1:p1", "key": "enter", "expect_label": "Yes"}),
    ] {
        let r = call(&sock, dir.path(), p.clone()).await;
        assert_eq!(r["error"]["code"], "bad_request", "{p} → {r}");
    }
    assert!(sent.lock().unwrap().is_empty(), "no herdr call for bad params");
}

#[test]
fn pane_answer_is_listed() {
    assert!(rpc::METHODS.contains(&"pane.answer"));
}
