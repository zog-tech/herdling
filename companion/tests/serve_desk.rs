use std::time::{Duration, Instant, SystemTime};

use zogsshd::phone_input;
use zogsshd::serve::desk::{Desk, DESK_WINDOW};
use zogsshd::types::AgentStatus::{Blocked, Idle, Working};

fn secs(n: u64) -> Duration {
    Duration::from_secs(n)
}

#[test]
fn new_desk_is_not_active() {
    assert!(!Desk::default().active(Instant::now()));
}

#[test]
fn active_for_window_after_touch() {
    let t0 = Instant::now();
    let mut d = Desk::default();
    d.touch(t0);
    assert!(d.active(t0));
    assert!(d.active(t0 + DESK_WINDOW - secs(1)));
    assert!(!d.active(t0 + DESK_WINDOW));
}

#[test]
fn focus_counts_and_sets_pane() {
    let t0 = Instant::now();
    let mut d = Desk::default();
    d.focus("p", t0);
    assert!(d.active(t0 + secs(60)));
    assert_eq!(d.focused(), Some("p"));
}

#[test]
fn set_focused_is_not_activity() {
    let mut d = Desk::default();
    d.set_focused(Some("p"));
    assert_eq!(d.focused(), Some("p"));
    assert!(!d.active(Instant::now()));
}

#[test]
fn focused_pane_starts_work_counts() {
    let t0 = Instant::now();
    let mut d = Desk::default();
    d.set_focused(Some("p"));
    d.agent_status("p", Some(Idle), Working, None, t0);
    assert!(d.active(t0));
}

#[test]
fn work_after_recent_phone_input_does_not_count() {
    let t0 = Instant::now();
    let mut d = Desk::default();
    d.set_focused(Some("p"));
    d.agent_status("p", Some(Blocked), Working, Some(secs(3)), t0);
    assert!(!d.active(t0));
    // Phone input long ago does not hide desk input.
    d.agent_status("p", Some(Idle), Working, Some(secs(15)), t0);
    assert!(d.active(t0));
}

#[test]
fn other_changes_do_not_count() {
    let t0 = Instant::now();
    let mut d = Desk::default();
    d.set_focused(Some("p"));
    d.agent_status("q", Some(Idle), Working, None, t0);
    d.agent_status("p", Some(Working), Idle, None, t0);
    d.agent_status("p", Some(Working), Working, None, t0);
    d.agent_status("p", None, Working, None, t0);
    assert!(!d.active(t0));
}

#[test]
fn input_pane_names_typing_methods_only() {
    let p = serde_json::json!({"pane_id": "w1:p1", "target": "w1:p2"});
    assert_eq!(phone_input::input_pane("pane.send_text", &p), Some("w1:p1"));
    assert_eq!(phone_input::input_pane("pane.send_keys", &p), Some("w1:p1"));
    assert_eq!(phone_input::input_pane("agent.prompt", &p), Some("w1:p2"));
    assert_eq!(phone_input::input_pane("pane.read", &p), None);
    assert_eq!(phone_input::input_pane("pane.send_text", &serde_json::json!({})), None);
}

#[test]
fn phone_input_mark_round_trip() {
    let dir = tempfile::tempdir().unwrap();
    assert_eq!(phone_input::last(dir.path(), "w1:p1"), None);
    let at = SystemTime::UNIX_EPOCH + Duration::from_millis(1_700_000_000_123);
    phone_input::mark(dir.path(), "w1:p1", at).unwrap();
    assert_eq!(phone_input::last(dir.path(), "w1:p1"), Some(at));
    assert_eq!(phone_input::last(dir.path(), "w1:p2"), None);
    phone_input::forget(dir.path(), "w1:p1");
    assert_eq!(phone_input::last(dir.path(), "w1:p1"), None);
}
