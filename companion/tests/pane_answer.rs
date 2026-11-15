//! `pane.answer`: checks the menu on the computer, then sends one digit, or answers `stale`.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::path::Path;
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

type Sent = fake_core::FakeCore;

/// A fake core whose terminal `t1` has `status` and shows `screen`. Records every call.
fn fake(dir: &Path, status: &'static str, screen: &'static str) -> (Ctx, Sent) {
    let state = fake_core::State { terminals: vec![fake_core::terminal("t1", None, Some(status))], screen: screen.into(), ..Default::default() };
    fake_core::with_ctx(dir, dir.into(), state)
}

async fn call(ctx: &Ctx, params: Value) -> Value {
    let (mut tx, server_in) = tokio::io::duplex(1 << 16);
    let (server_out, client_rx) = tokio::io::duplex(1 << 16);
    tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx.clone()));
    let req = json!({"id": 1, "method": "pane.answer", "params": params});
    tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
    let mut lines = BufReader::new(client_rx).lines();
    let l = tokio::time::timeout(Duration::from_secs(10), lines.next_line()).await.unwrap().unwrap().unwrap();
    serde_json::from_str(&l).unwrap()
}

fn keys_sent(sent: &Sent) -> Vec<Value> {
    sent.calls_of("terminal.keys")
}

#[tokio::test]
async fn answers_when_the_menu_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(keys_sent(&sent), [json!({"terminal": "t1", "keys": ["1"]})]);
    assert_eq!(sent.calls_of("terminal.read")[0], json!({"terminal": "t1", "lines": 0}));
}

#[tokio::test]
async fn accepts_the_cut_label_of_a_push() {
    let dir = tempfile::tempdir().unwrap();
    let screen: &'static str = Box::leak(
        format!("❯ 1. Yes\n  2. No, and tell Claude what to do differently because {}", "x".repeat(40)).into_boxed_str(),
    );
    let (ctx, sent) = fake(dir.path(), "blocked", screen);
    let full = herdlingd::choices::parse_choices(screen)[1].label.clone();
    let r = call(&ctx, json!({"pane_id": "t1", "key": "2", "expect_label": short_label(&full)})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(keys_sent(&sent).len(), 1);
}

#[tokio::test]
async fn stale_when_the_label_changed() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    let r = call(&ctx, json!({"pane_id": "t1", "key": "3", "expect_label": "No"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_there_is_no_menu() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", "> \n  ? for shortcuts");
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_key_is_not_in_the_menu() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    let r = call(&ctx, json!({"pane_id": "t1", "key": "4", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_agent_no_longer_waits() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "working", MENU);
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
}

#[tokio::test]
async fn stale_when_the_pane_is_gone() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, _sent) = fake(dir.path(), "blocked", MENU);
    let r = call(&ctx, json!({"pane_id": "t9", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
}

#[tokio::test]
async fn rejects_bad_params() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    for p in [
        json!({"pane_id": "t1", "key": "1"}),
        json!({"pane_id": "t1", "expect_label": "Yes"}),
        json!({"key": "1", "expect_label": "Yes"}),
        json!({"pane_id": "", "key": "1", "expect_label": "Yes"}),
        json!({"pane_id": "t1", "key": "0", "expect_label": "Yes"}),
        json!({"pane_id": "t1", "key": "12", "expect_label": "Yes"}),
        json!({"pane_id": "t1", "key": "enter", "expect_label": "Yes"}),
    ] {
        let r = call(&ctx, p.clone()).await;
        assert_eq!(r["error"]["code"], "bad_request", "{p} → {r}");
    }
    assert!(sent.calls.lock().unwrap().is_empty(), "no core call for bad params");
}

#[test]
fn pane_answer_is_listed() {
    assert!(rpc::METHODS.contains(&"pane.answer"));
}

const OTHER_MENU: &str = "╭────────────────────────────────╮\n\
                          │ Bash command                   │\n\
                          │   rm -rf build                 │\n\
                          │ Do you want to proceed?        │\n\
                          │ ❯ 1. Yes                       │\n\
                          │   2. Yes, and don't ask again  │\n\
                          │   3. No, and tell Claude what to do differently (esc) │\n\
                          ╰────────────────────────────────╯";

#[tokio::test]
async fn answers_when_the_question_is_unchanged() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    let q = herdlingd::choices::menu_question(MENU).unwrap();
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes", "expect_question": q})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
    assert_eq!(keys_sent(&sent).len(), 1);
}

#[tokio::test]
async fn stale_when_a_later_prompt_has_the_same_labels() {
    // The push was for MENU. The agent now asks OTHER_MENU, with the same labels.
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", OTHER_MENU);
    let q = herdlingd::choices::menu_question(MENU).unwrap();
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes", "expect_question": q})).await;
    assert_eq!(r["error"]["code"], "stale", "{r}");
    assert!(keys_sent(&sent).is_empty());
    // An older app sends no question: the label check alone decides, as before.
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes"})).await;
    assert_eq!(r["result"], json!({"answered": true}), "{r}");
}

#[tokio::test]
async fn rejects_a_question_that_is_not_a_string() {
    let dir = tempfile::tempdir().unwrap();
    let (ctx, sent) = fake(dir.path(), "blocked", MENU);
    let r = call(&ctx, json!({"pane_id": "t1", "key": "1", "expect_label": "Yes", "expect_question": 5})).await;
    assert_eq!(r["error"]["code"], "bad_request", "{r}");
    assert!(keys_sent(&sent).is_empty());
}
