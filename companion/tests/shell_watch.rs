//! The rules and the state file of "Notify me when it finishes" (`shell.watch`).

use std::fs;

use herdlingd::shell_watch::*;
use serde_json::json;

fn watch(busy: Option<&str>) -> Watch {
    Watch { pane_id: "w1:p2".into(), since: 1000, device_id: None, busy: busy.map(String::from), cwd: None }
}

#[test]
fn probe_reads_idle_busy_and_unknown() {
    assert_eq!(probe(&json!({"shell_pid": 41, "foreground_process_group_id": 41})), Probe::Idle);
    assert_eq!(probe(&json!({"shell_pid": null})), Probe::Unknown);
    assert_eq!(probe(&json!({})), Probe::Unknown);
    let busy = json!({
        "shell_pid": 41,
        "foreground_process_group_id": 77,
        "foreground_processes": [
            {"pid": 78, "name": "node", "cmdline": "node child.js"},
            {"pid": 77, "name": "pnpm", "cmdline": "pnpm test --watch=false", "cwd": "/home/sam/proj"}
        ]
    });
    assert_eq!(probe(&busy), Probe::Busy { command: "pnpm test --watch=false".into(), cwd: Some("/home/sam/proj".into()) });
}

#[test]
fn probe_falls_back_to_argv_then_name() {
    let argv = json!({"shell_pid": 1, "foreground_process_group_id": 2, "foreground_processes": [{"pid": 2, "name": "make", "argv": ["make", "-j4"]}]});
    assert_eq!(probe(&argv), Probe::Busy { command: "make -j4".into(), cwd: None });
    let name = json!({"shell_pid": 1, "foreground_process_group_id": 2, "foreground_processes": [{"pid": 2, "name": "cargo"}]});
    assert_eq!(probe(&name), Probe::Busy { command: "cargo".into(), cwd: None });
    let none = json!({"shell_pid": 1, "foreground_process_group_id": 2});
    assert_eq!(probe(&none), Probe::Busy { command: String::new(), cwd: None });
}

#[test]
fn busy_then_idle_finishes_once() {
    let w = watch(None);
    let busy = Probe::Busy { command: "cargo build".into(), cwd: Some("/home/sam/proj".into()) };
    let Step::Update(w) = step(&w, &busy, 1003) else { panic!("busy saves the command") };
    assert_eq!(w.busy.as_deref(), Some("cargo build"));
    assert_eq!(step(&w, &busy, 1006), Step::Keep);
    assert_eq!(
        step(&w, &Probe::Idle, 1009),
        Step::Finished { command: "cargo build".into(), cwd: Some("/home/sam/proj".into()) }
    );
}

#[test]
fn idle_before_busy_keeps_waiting() {
    assert_eq!(step(&watch(None), &Probe::Idle, 1003), Step::Keep);
}

#[test]
fn unknown_keeps_and_gone_drops() {
    assert_eq!(step(&watch(Some("sleep 60")), &Probe::Unknown, 1003), Step::Keep);
    assert_eq!(step(&watch(Some("sleep 60")), &Probe::Gone, 1003), Step::Drop);
}

#[test]
fn watch_expires_after_a_day() {
    let w = watch(Some("sleep 1d"));
    let end = 1000 + WATCH_TTL.as_secs();
    assert_eq!(step(&w, &Probe::Idle, end - 1), Step::Finished { command: "sleep 1d".into(), cwd: None });
    assert_eq!(step(&w, &Probe::Idle, end), Step::Drop);
}

#[test]
fn empty_command_keeps_the_last_one() {
    let w = watch(Some("vim notes.md"));
    assert_eq!(step(&w, &Probe::Busy { command: String::new(), cwd: None }, 1003), Step::Keep);
}

#[test]
fn push_text_uses_the_folder_tail_and_cuts_the_command() {
    assert_eq!(push_text(Some("/home/sam/proj/"), "pnpm  test\n--ci"), ("proj: command finished".into(), "pnpm test --ci".into()));
    assert_eq!(push_text(None, "ls").0, "Terminal: command finished");
    let long = "x".repeat(200);
    let body = push_text(Some("/"), &long).1;
    assert_eq!(body.chars().count(), MAX_COMMAND);
    assert!(body.ends_with('…'));
}

#[test]
fn file_adds_replaces_lists_and_removes() {
    let dir = tempfile::tempdir().unwrap();
    let p = path(dir.path());
    assert!(list(&p, 0).unwrap().is_empty());
    assert!(!p.exists(), "list creates no file");
    add(&p, "w1:p2", Some("dev1"), 100).unwrap();
    add(&p, "w1:p3", None, 101).unwrap();
    add(&p, "w1:p2", Some("dev2"), 102).unwrap();
    let ws = list(&p, 103).unwrap();
    assert_eq!(ws.len(), 2);
    assert_eq!(ws.iter().find(|w| w.pane_id == "w1:p2").unwrap().device_id.as_deref(), Some("dev2"));
    use std::os::unix::fs::PermissionsExt;
    assert_eq!(fs::metadata(&p).unwrap().permissions().mode() & 0o777, 0o600);
    assert!(remove(&p, "w1:p3", 104).unwrap());
    assert!(!remove(&p, "w1:p3", 104).unwrap());
    assert_eq!(list(&p, 105).unwrap().len(), 1);
    assert!(list(&p, 102 + WATCH_TTL.as_secs()).unwrap().is_empty(), "expired watches go away");
}

#[test]
fn file_keeps_at_most_max_watches() {
    let dir = tempfile::tempdir().unwrap();
    let p = path(dir.path());
    for i in 0..MAX_WATCHES + 3 {
        add(&p, &format!("p{i}"), None, 100 + i as u64).unwrap();
    }
    let ws = list(&p, 200).unwrap();
    assert_eq!(ws.len(), MAX_WATCHES);
    assert!(!ws.iter().any(|w| w.pane_id == "p0"), "the oldest watch goes first");
}

#[test]
fn apply_skips_a_watch_that_was_replaced() {
    let dir = tempfile::tempdir().unwrap();
    let p = path(dir.path());
    let old = add(&p, "w1:p2", None, 100).unwrap();
    let other = add(&p, "w1:p3", None, 100).unwrap();
    // A new shell.watch of the same pane arrives during the round.
    add(&p, "w1:p2", None, 105).unwrap();
    let busy = Watch { busy: Some("make".into()), ..other.clone() };
    let applied = apply(&p, 106, &[(old, None), (other, Some(busy.clone()))]).unwrap();
    assert_eq!(applied, vec![false, true]);
    let ws = list(&p, 106).unwrap();
    assert_eq!(ws.len(), 2);
    assert!(ws.contains(&busy));
    assert!(ws.iter().any(|w| w.pane_id == "w1:p2" && w.since == 105));
}
