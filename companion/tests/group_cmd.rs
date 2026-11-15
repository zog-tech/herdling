//! `herdlingd group`: the argument rules and the label call on the own terminal, with a fake
//! core.

#[path = "support/fake_core.rs"]
mod fake_core;

use std::time::Duration;

use fake_core::{terminal, State};
use herdlingd::group_cmd::{labels, parse, run, GroupCmd};
use serde_json::json;

fn args(a: &[&str]) -> Vec<String> {
    a.iter().map(|s| s.to_string()).collect()
}

#[test]
fn parse_rules() {
    assert_eq!(parse(&args(&["Clips"])).unwrap(), GroupCmd::Set("Clips".into()));
    assert_eq!(parse(&args(&["web", "app"])).unwrap(), GroupCmd::Set("web app".into()));
    assert_eq!(parse(&args(&["--clear"])).unwrap(), GroupCmd::Clear);
    for bad in [args(&[]), args(&[" "]), args(&["--x"]), args(&["a", "--clear"]), args(&[&"x".repeat(65)]), args(&["a\tb"])] {
        assert!(parse(&bad).is_err(), "{bad:?}");
    }
    assert_eq!(labels(&GroupCmd::Clear), json!({"herdling.group": ""}));
}

#[tokio::test]
async fn group_sets_and_clears_the_label_on_the_own_terminal() {
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("core.sock");
    let mut t1 = terminal("t1", None, Some("idle"));
    t1["labels"] = json!({"where": "api / 1"});
    let core = fake_core::spawn(&sock, State { terminals: vec![t1, terminal("t2", None, None)], ..State::default() });
    let t = Duration::from_secs(5);
    let text = run(&GroupCmd::Set("Clips".into()), Some("t1".into()), Some(sock.clone()), None, t).await.unwrap();
    assert!(text.contains("Clips"), "{text}");
    assert_eq!(core.calls_of("terminal.label"), [json!({"terminal": "t1", "labels": {"herdling.group": "Clips"}})]);
    run(&GroupCmd::Clear, Some("t1".into()), Some(sock.clone()), None, t).await.unwrap();
    let st = core.state.lock().unwrap();
    assert_eq!(st.terminals[0]["labels"], json!({"where": "api / 1"}), "only herdling.group changes");
    assert_eq!(st.terminals[1]["labels"], json!({}));
}

#[tokio::test]
async fn outside_a_core_terminal_fails() {
    let e = run(&GroupCmd::Clear, None, None, None, Duration::from_secs(1)).await.unwrap_err();
    assert!(e.contains("HC_TERMINAL_ID"), "{e}");
    let dir = tempfile::tempdir().unwrap();
    let sock = dir.path().join("core.sock");
    let _core = fake_core::spawn(&sock, State { methods: Some(vec!["hello".into()]), ..State::default() });
    let e = run(&GroupCmd::Clear, Some("t1".into()), Some(sock), None, Duration::from_secs(1)).await.unwrap_err();
    assert!(e.contains("terminal.label"), "{e}");
}
