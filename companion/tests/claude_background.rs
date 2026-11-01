//! Background shells and subagents in a Claude log: start, end, stop, several, reset and the
//! stale cap. The lines are synthetic and minimal.

use std::io::Write;

use serde_json::{json, Value};
use herdlingd::claude::background::{background_id, ClaudeFeed};
use herdlingd::transcript::background::{short_command, BackgroundLog, LineFeed, Tracker, STALE_MS};
use herdlingd::types::BackgroundInfo;

const T0: &str = "2026-10-29T10:00:00.000Z";
/// `T0` in Unix ms.
const T0_MS: i64 = 1_793_268_000_000;

fn bash(id: &str, command: &str, background: bool) -> String {
    let mut input = json!({"command": command, "description": "run"});
    if background {
        input["run_in_background"] = json!(true);
    }
    json!({"type": "assistant", "timestamp": T0,
           "message": {"role": "assistant", "content": [{"type": "tool_use", "id": id, "name": "Bash", "input": input}]}})
    .to_string()
}

fn started(call: &str, task: &str) -> String {
    json!({"type": "user", "timestamp": T0,
           "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call,
               "content": format!("Command running in background with ID: {task}. Output is being written to: /tmp/tasks/{task}.output")}]},
           "toolUseResult": {"stdout": "", "stderr": "", "interrupted": false, "backgroundTaskId": task}})
    .to_string()
}

fn notice(kind: &str, task: &str, status: &str) -> String {
    let text = format!(
        "<task-notification>\n<task-id>{task}</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<status>{status}</status>\n<summary>Done</summary>\n</task-notification>"
    );
    match kind {
        "queue" => json!({"type": "queue-operation", "operation": "enqueue", "timestamp": T0, "content": text}),
        "attachment" => json!({"type": "attachment", "timestamp": T0, "attachment": {"type": "queued_command", "prompt": text}}),
        _ => json!({"type": "user", "timestamp": T0, "message": {"role": "user", "content": text}}),
    }
    .to_string()
}

fn tool(id: &str, name: &str, input: Value) -> String {
    json!({"type": "assistant", "timestamp": T0,
           "message": {"role": "assistant", "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}})
    .to_string()
}

fn result(call: &str, text: &str, extra: Value) -> String {
    json!({"type": "user", "timestamp": T0,
           "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": call, "content": text}]},
           "toolUseResult": extra})
    .to_string()
}

fn run(lines: &[String]) -> Tracker {
    let mut feed = ClaudeFeed::default();
    let mut t = Tracker::default();
    for l in lines {
        feed.feed(&mut t, l);
    }
    t
}

fn info(t: &Tracker) -> Option<BackgroundInfo> {
    t.info(T0_MS + 1000, None)
}

#[test]
fn shell_starts_and_ends_with_a_notification() {
    let mut lines = vec![bash("c1", "npm run dev", true), started("c1", "b1")];
    let t = run(&lines);
    assert_eq!(info(&t), Some(BackgroundInfo { count: 1, commands: vec!["npm run dev".into()], agents: 0 }));
    for kind in ["queue", "attachment", "user"] {
        lines.truncate(2);
        lines.push(notice(kind, "b1", "completed"));
        assert_eq!(info(&run(&lines)), None, "{kind}");
    }
}

#[test]
fn failed_and_killed_shells_end() {
    for status in ["failed", "killed", "stopped"] {
        let t = run(&[bash("c1", "sleep 30", true), started("c1", "b1"), notice("user", "b1", status)]);
        assert_eq!(info(&t), None, "{status}");
    }
}

#[test]
fn a_foreground_command_is_not_background() {
    let t = run(&[bash("c1", "ls", false), result("c1", "a\nb", json!({"stdout": "a\nb", "stderr": ""}))]);
    assert_eq!(info(&t), None);
}

#[test]
fn output_that_quotes_a_background_line_is_not_a_start() {
    let t = run(&[
        bash("c1", "cat notes.txt", false),
        result("c1", "Command running in background with ID: b5. Output is", json!({"stdout": "x", "stderr": ""})),
    ]);
    assert_eq!(info(&t), None);
}

#[test]
fn a_command_moved_to_the_background_counts() {
    let t = run(&[
        bash("c1", "cargo build", false),
        result("c1", "Command was manually backgrounded by user with ID: b2. Output is being written to: /tmp/b2.output",
               json!({"backgroundTaskId": "b2", "backgroundedByUser": true})),
    ]);
    assert_eq!(info(&t).map(|i| i.count), Some(1));
}

#[test]
fn a_stopped_shell_ends_without_a_notification() {
    let lines = vec![
        bash("c1", "npm run dev", true),
        started("c1", "b1"),
        tool("c2", "TaskStop", json!({"task_id": "b1"})),
        result("c2", "{\"message\":\"Successfully stopped task: b1\"}", json!({"task_id": "b1", "task_type": "local_bash"})),
    ];
    assert_eq!(info(&run(&lines)), None);
    // The older tool name.
    let lines = vec![
        bash("c1", "npm run dev", true),
        started("c1", "b1"),
        tool("c2", "KillShell", json!({"shell_id": "b1"})),
        result("c2", "Shell b1 killed", json!({})),
    ];
    assert_eq!(info(&run(&lines)), None);
}

#[test]
fn a_failed_stop_keeps_the_shell() {
    let stop_failed = json!({"type": "user", "timestamp": T0,
        "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "c2", "is_error": true, "content": "denied"}]}})
    .to_string();
    let t = run(&[bash("c1", "npm run dev", true), started("c1", "b1"), tool("c2", "TaskStop", json!({"task_id": "b1"})), stop_failed]);
    assert_eq!(info(&t).map(|i| i.count), Some(1));
}

#[test]
fn several_shells_count_and_list_newest_first() {
    let mut lines = Vec::new();
    for (i, cmd) in ["npm run dev", "sleep 30", "pnpm test --watch", "make serve"].iter().enumerate() {
        lines.push(bash(&format!("c{i}"), cmd, true));
        lines.push(started(&format!("c{i}"), &format!("b{i}")));
    }
    let i = info(&run(&lines)).unwrap();
    assert_eq!(i.count, 4);
    assert_eq!(i.commands, vec!["make serve", "pnpm test --watch", "sleep 30"]);
    lines.push(notice("queue", "b3", "completed"));
    let i = info(&run(&lines)).unwrap();
    assert_eq!(i.count, 3);
    assert_eq!(i.commands[0], "pnpm test --watch");
}

#[test]
fn background_subagents_count_apart_from_shells() {
    let lines = vec![
        tool("c1", "Agent", json!({"description": "Review", "prompt": "p", "run_in_background": true})),
        result("c1", "Async agent launched successfully.", json!({"status": "async_launched", "isAsync": true, "agentId": "a1"})),
        bash("c2", "npm run dev", true),
        started("c2", "b1"),
    ];
    assert_eq!(info(&run(&lines)), Some(BackgroundInfo { count: 1, commands: vec!["npm run dev".into()], agents: 1 }));
    let mut done = lines.clone();
    done.push(notice("user", "a1", "completed"));
    assert_eq!(info(&run(&done)), Some(BackgroundInfo { count: 1, commands: vec!["npm run dev".into()], agents: 0 }));
}

#[test]
fn stale_shells_end_after_the_cap() {
    let t = run(&[bash("c1", "npm run dev", true), started("c1", "b1")]);
    assert!(t.info(T0_MS + STALE_MS - 1, None).is_some());
    assert!(t.info(T0_MS + STALE_MS, None).is_none());
}

#[test]
fn shells_from_before_an_agent_restart_end() {
    let t = run(&[bash("c1", "npm run dev", true), started("c1", "b1")]);
    assert!(t.info(T0_MS + 5000, Some(T0_MS - 60_000)).is_some());
    assert!(t.info(T0_MS + 5000, Some(T0_MS + 1000)).is_none());
}

#[test]
fn reset_forgets_every_task() {
    let mut t = run(&[bash("c1", "npm run dev", true), started("c1", "b1")]);
    t.reset();
    assert!(t.is_empty());
    assert_eq!(info(&t), None);
}

#[test]
fn id_from_text_and_short_commands() {
    assert_eq!(background_id("Command running in background with ID: b0x9. Output is"), Some("b0x9".into()));
    assert_eq!(background_id("Command was moved to the background (ID: b7) so that"), Some("b7".into()));
    assert_eq!(background_id("Shell cwd was reset to /home/sam/proj\nCommand was moved to the background (ID: b8) so"), Some("b8".into()));
    assert_eq!(background_id("ID: b7"), None);
    // Output of an ordinary command that quotes such a line.
    assert_eq!(background_id("a\nb\nc\nCommand running in background with ID: b9."), None);
    assert_eq!(short_command("  npm   run\n dev "), "npm run dev");
    let long = short_command(&"x".repeat(100));
    assert_eq!(long.chars().count(), 40);
    assert!(long.ends_with('…'));
}

#[test]
fn several_results_on_one_line_use_the_text() {
    let line = json!({"type": "user", "timestamp": T0, "message": {"role": "user", "content": [
        {"type": "tool_result", "tool_use_id": "c1", "content": "Command running in background with ID: b1. Output is being written to: /tmp/b1"},
        {"type": "tool_result", "tool_use_id": "c2", "content": "ok"}]}})
    .to_string();
    let t = run(&[bash("c1", "npm run dev", true), bash("c2", "ls", false), line]);
    assert_eq!(info(&t).map(|i| i.count), Some(1));
}

#[test]
fn log_reads_new_lines_and_a_new_log_starts_empty() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.jsonl");
    let mut f = std::fs::File::create(&path).unwrap();
    writeln!(f, "{}", bash("c1", "npm run dev", true)).unwrap();
    writeln!(f, "{}", started("c1", "b1")).unwrap();
    // A line still being written is left for the next read.
    write!(f, "{{\"type\":\"user\"").unwrap();
    f.flush().unwrap();
    let mut log: BackgroundLog<ClaudeFeed> = BackgroundLog::new(&path);
    log.update().unwrap();
    assert_eq!(log.tracker.info(T0_MS, None).map(|i| i.count), Some(1));

    // Finish the partial line as junk, then end the shell.
    writeln!(f, "}}").unwrap();
    writeln!(f, "{}", notice("queue", "b1", "completed")).unwrap();
    f.flush().unwrap();
    log.update().unwrap();
    assert_eq!(log.tracker.info(T0_MS, None), None);

    // A log that got shorter (replaced) is read again from the start.
    let mut f = std::fs::File::create(&path).unwrap();
    writeln!(f, "{}", bash("c9", "sleep 30", true)).unwrap();
    writeln!(f, "{}", started("c9", "b9")).unwrap();
    f.flush().unwrap();
    log.update().unwrap();
    assert_eq!(log.tracker.info(T0_MS, None).map(|i| i.commands), Some(vec!["sleep 30".to_string()]));

    // Another session's log is a new state with no tasks.
    let other = dir.path().join("t.jsonl");
    std::fs::write(&other, format!("{}\n", bash("c1", "ls", false))).unwrap();
    let mut log2: BackgroundLog<ClaudeFeed> = BackgroundLog::new(&other);
    log2.update().unwrap();
    assert!(log2.tracker.is_empty());
}
