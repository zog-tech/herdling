//! `agents.preview`: Claude log tails, the screen fallback, caps and the rpc round trip.

#[path = "support/fake_herdr.rs"]
mod fake_herdr;
#[path = "support/fake_herdr_events.rs"]
mod fake_herdr_events;

use std::path::{Path, PathBuf};

use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use herdlingd::preview::{self, log_preview, screen_line, screen_question, strip_markdown, PreviewState, LINE_CAP};
use herdlingd::rpc::{self, Ctx};

fn prompt(uuid: &str, text: &str) -> String {
    json!({"type": "user", "uuid": uuid, "timestamp": "2026-10-29T10:00:00.000Z",
           "message": {"role": "user", "content": text}})
    .to_string()
}

fn reply(uuid: &str, text: &str) -> String {
    json!({"type": "assistant", "uuid": uuid, "timestamp": "2026-10-29T10:00:01.000Z",
           "message": {"role": "assistant", "content": [{"type": "text", "text": text}]}})
    .to_string()
}

fn thinking(uuid: &str) -> String {
    json!({"type": "assistant", "uuid": uuid, "timestamp": "2026-10-29T10:00:01.000Z",
           "message": {"role": "assistant", "content": [{"type": "thinking", "thinking": "hmm", "signature": "s"}]}})
    .to_string()
}

fn tool(uuid: &str, id: &str, name: &str, input: Value) -> String {
    json!({"type": "assistant", "uuid": uuid, "timestamp": "2026-10-29T10:00:02.000Z",
           "message": {"role": "assistant", "content": [{"type": "tool_use", "id": id, "name": name, "input": input}]}})
    .to_string()
}

fn result(uuid: &str, id: &str) -> String {
    json!({"type": "user", "uuid": uuid, "timestamp": "2026-10-29T10:00:03.000Z",
           "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": id, "content": "ok"}]}})
    .to_string()
}

fn preview_of(lines: &[String]) -> preview::LogPreview {
    log_preview(lines.iter().map(String::as_str))
}

#[test]
fn working_with_bash_pending() {
    let p = preview_of(&[
        prompt("u1", "Fix the auth tests"),
        reply("a1", "I'll run the tests first."),
        tool("a2", "t1", "Bash", json!({"command": "pnpm test --filter auth"})),
    ]);
    assert_eq!(p.activity.as_deref(), Some("Running pnpm test --filter auth"));
    assert_eq!(p.last_reply.as_deref(), Some("I'll run the tests first."));
}

#[test]
fn working_with_edit_pending() {
    let p = preview_of(&[
        prompt("u1", "Fix it"),
        tool("a1", "t1", "Read", json!({"file_path": "/home/sam/proj/src/auth.ts"})),
        result("r1", "t1"),
        tool("a2", "t2", "Edit", json!({"file_path": "/home/sam/proj/src/auth.ts", "old_string": "a", "new_string": "b"})),
    ]);
    assert_eq!(p.activity.as_deref(), Some("Editing auth.ts"));
}

#[test]
fn activity_names_per_tool() {
    let one = |name: &str, input: Value| {
        preview_of(&[prompt("u1", "go"), tool("a1", "t1", name, input)]).activity.unwrap()
    };
    assert_eq!(one("Grep", json!({"pattern": "x"})), "Searching");
    assert_eq!(one("Glob", json!({"pattern": "*.rs"})), "Searching");
    assert_eq!(one("WebFetch", json!({"url": "https://example.com"})), "Browsing");
    assert_eq!(one("WebSearch", json!({"query": "x"})), "Browsing");
    assert_eq!(one("Task", json!({"description": "look around"})), "Running a subagent");
    assert_eq!(one("Read", json!({"file_path": "/home/sam/proj/README.md"})), "Reading README.md");
    assert_eq!(one("mcp__files__list_dir", json!({})), "Using list_dir");

    let reads = preview_of(&[
        prompt("u1", "go"),
        tool("a1", "t1", "Read", json!({"file_path": "/a.rs"})),
        tool("a2", "t2", "Read", json!({"file_path": "/b.rs"})),
        tool("a3", "t3", "Read", json!({"file_path": "/c.rs"})),
    ]);
    assert_eq!(reads.activity.as_deref(), Some("Reading 3 files"));
}

#[test]
fn thinking_only_is_thinking() {
    let p = preview_of(&[prompt("u1", "go"), thinking("a1")]);
    assert_eq!(p.activity.as_deref(), Some("Thinking"));
    assert_eq!(p.last_reply, None);
}

#[test]
fn idle_with_last_reply_has_no_activity() {
    let p = preview_of(&[
        prompt("u1", "Fix it"),
        tool("a1", "t1", "Bash", json!({"command": "pnpm test"})),
        result("r1", "t1"),
        reply("a2", "All 42 tests pass now."),
    ]);
    assert_eq!(p.activity, None);
    assert_eq!(p.question, None);
    assert_eq!(p.last_reply.as_deref(), Some("All 42 tests pass now."));
}

#[test]
fn blocked_permission_tool_gives_question() {
    let p = preview_of(&[
        prompt("u1", "Ship it"),
        reply("a1", "Pushing now."),
        tool("a2", "t1", "Bash", json!({"command": "git push"})),
    ]);
    assert_eq!(p.question.as_deref(), Some("Allow git push?"));
    let p = preview_of(&[prompt("u1", "go"), tool("a1", "t1", "Write", json!({"file_path": "/home/sam/proj/.env"}))]);
    assert_eq!(p.question.as_deref(), Some("Allow edit to .env?"));
}

#[test]
fn a_new_prompt_ends_the_old_turn() {
    // The pending call belongs to an interrupted turn; the new prompt has none yet.
    let p = preview_of(&[
        prompt("u1", "go"),
        tool("a1", "t1", "Bash", json!({"command": "sleep 100"})),
        prompt("u2", "never mind"),
    ]);
    assert_eq!(p.activity, None);
}

#[test]
fn markdown_is_stripped_to_one_line() {
    let md = "## Done\n\nI **fixed** the `retry` in [fetch.ts](src/fetch.ts).\n\n```ts\nconst x = 1;\n```\n\n- tests pass\n> note";
    let p = preview_of(&[prompt("u1", "go"), reply("a1", md)]);
    assert_eq!(p.last_reply.as_deref(), Some("Done I fixed the retry in fetch.ts. tests pass note"));
    assert_eq!(strip_markdown("1. first\n2) second"), "first\nsecond");
}

#[test]
fn caps_are_respected() {
    let long = "word ".repeat(200);
    let p = preview_of(&[prompt("u1", "go"), reply("a1", &long)]);
    let r = p.last_reply.unwrap();
    assert!(r.chars().count() <= LINE_CAP, "{} chars", r.chars().count());
    assert!(r.ends_with('…'));

    let cmd = format!("echo {}", "x".repeat(100));
    let a = preview_of(&[prompt("u1", "go"), tool("a1", "t1", "Bash", json!({"command": cmd}))]).activity.unwrap();
    assert!(a.chars().count() <= "Running ".len() + 40, "{a}");
    assert!(a.ends_with('…'));
}

#[test]
fn read_log_reads_only_the_tail() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("s.jsonl");
    // 1 MiB of old turns, then the live one.
    let mut text = String::new();
    let old = reply("old", &"old reply ".repeat(50));
    while text.len() < 1 << 20 {
        text.push_str(&old);
        text.push('\n');
    }
    for l in [prompt("u1", "go"), reply("a1", "Latest words."), tool("a2", "t1", "Bash", json!({"command": "cargo test"}))] {
        text.push_str(&l);
        text.push('\n');
    }
    // A line still being written.
    text.push_str("{\"type\":\"assistant\",\"mess");
    std::fs::write(&path, text).unwrap();
    let p = preview::read_log(&path).unwrap();
    assert_eq!(p.last_reply.as_deref(), Some("Latest words."));
    assert_eq!(p.activity.as_deref(), Some("Running cargo test"));
}

fn screen(name: &str) -> String {
    std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/screens").join(name)).unwrap()
}

#[test]
fn screen_fallback_skips_the_input_box_and_footer() {
    let boxed = "\
• Ran tests: 12 passed\n\
╭──────────────────────────────╮\n\
│ › Explain this codebase      │\n\
╰──────────────────────────────╯\n\
   ⠋  \n\
\n";
    assert_eq!(screen_line(boxed).as_deref(), Some("Ran tests: 12 passed"));
    assert_eq!(screen_line("$ \n> \n────\n"), None);
    let long = format!("{}\n", "y".repeat(400));
    assert!(screen_line(&long).unwrap().chars().count() <= LINE_CAP);
}

#[test]
fn screen_fixtures_give_the_last_output_line() {
    assert_eq!(
        screen_line(&screen("codex_idle.txt")).as_deref(),
        Some("The flaky test waited on a real timer. It now uses fake timers, and 12 tests pass.")
    );
    assert_eq!(screen_line(&screen("codex_working.txt")).as_deref(), Some("3 migrations applied"));
    assert_eq!(
        screen_line(&screen("gemini_idle.txt")).as_deref(),
        Some("I updated the README with the pairing steps and the push setup.")
    );
    assert_eq!(
        screen_line(&screen("rules_idle.txt")).as_deref(),
        Some("Done. Both endpoints now return 404 for a missing user.")
    );
}

#[test]
fn screen_question_reads_the_dialog_box() {
    let dialog = "\
• Ran ls\n\
╭──────────────────────────────────────╮\n\
│ Do you want to run git push?         │\n\
│ ❯ 1. Yes                             │\n\
│   2. No, tell the agent what to do   │\n\
╰──────────────────────────────────────╯\n\
  esc to cancel\n";
    assert_eq!(screen_question(dialog).as_deref(), Some("Do you want to run git push?"));
}

#[test]
fn status_since_comes_from_events() {
    let s = PreviewState::default();
    // First sighting in a snapshot: unknown.
    assert_eq!(s.status_since("w1:p1", "idle"), None);
    let before = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_secs() as i64;
    s.observe_event(&fake_herdr_events::status_ev("w1:p1", "working"));
    let since = s.status_since("w1:p1", "working").expect("known after an event");
    assert!(since >= before);
    // A snapshot with the same status keeps the start.
    assert_eq!(s.status_since("w1:p1", "working"), Some(since));
    // A change seen only in a snapshot (event missed) starts now.
    assert!(s.status_since("w1:p1", "blocked").is_some());
    // A closed pane is forgotten.
    s.observe_event(&json!({"event": "pane_closed", "data": {"pane_id": "w1:p1"}}));
    assert_eq!(s.status_since("w1:p1", "idle"), None);
}

struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
}

impl Session {
    fn start(sock: PathBuf, home: PathBuf) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(1 << 16);
        let (server_out, client_rx) = tokio::io::duplex(1 << 16);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, Ctx::new(sock, home)));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines() }
    }
    async fn call(&mut self, method: &str, params: Value) -> Value {
        let req = json!({"id": 1, "method": method, "params": params});
        self.tx.write_all(format!("{req}\n").as_bytes()).await.unwrap();
        serde_json::from_str(&self.rx.next_line().await.unwrap().unwrap()).unwrap()
    }
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// Three panes: a working Claude agent with a log, a blocked Codex agent whose screen
/// asks a question, and an idle Codex agent whose screen cannot be read.
fn fake_host(dir: &Path) -> (PathBuf, PathBuf) {
    let home = dir.join("home");
    write(&home.join(".claude/sessions/4242.json"), r#"{"pid":4242,"sessionId":"abc-123","cwd":"/home/sam/proj"}"#);
    let log = [prompt("u1", "Fix it"), tool("a1", "t1", "Bash", json!({"command": "pnpm test"}))].join("\n") + "\n";
    write(&home.join(".claude/projects/-home-sam-proj/abc-123.jsonl"), &log);
    let sock = dir.join("herdr.sock");
    fake_herdr::spawn_fn(&sock, |method, params| {
        let pane = params["pane_id"].as_str().or(params["target"].as_str()).unwrap_or("");
        match method {
            "session.snapshot" => Some(json!({"snapshot": {"agents": [
                {"pane_id": "w1:p1", "agent": "claude", "agent_status": "working", "cwd": "/home/sam/proj"},
                {"pane_id": "w1:p2", "agent": "codex", "agent_status": "blocked", "cwd": "/home/sam/proj"},
                {"pane_id": "w1:p3", "agent": "codex", "agent_status": "idle", "cwd": "/home/sam/proj"},
            ]}})),
            "agent.get" => Some(json!({"agent": {"agent": "claude", "cwd": "/home/sam/proj", "pane_id": pane}})),
            "pane.process_info" => Some(json!({"process_info": {"pane_id": pane, "shell_pid": 1,
                "foreground_process_group_id": 4242, "foreground_processes": [{"pid": 4242, "name": "claude"}]}})),
            "pane.read" if pane == "w1:p2" => Some(json!({"read": {"text": "Would you like to run `rm -rf build`?\n│ 1. Yes │\n"}})),
            _ => None,
        }
    });
    (sock, home)
}

#[tokio::test]
async fn rpc_previews_every_agent_and_skips_failures() {
    let dir = tempfile::tempdir().unwrap();
    let (sock, home) = fake_host(dir.path());
    let mut s = Session::start(sock, home);
    let r = s.call("agents.preview", json!({})).await;
    let list = r["result"]["previews"].as_array().unwrap_or_else(|| panic!("{r}"));
    assert_eq!(list.len(), 2, "{r}");
    assert_eq!(list[0]["pane_id"], "w1:p1");
    assert_eq!(list[0]["source"], "log");
    assert_eq!(list[0]["activity"], "Running pnpm test");
    assert_eq!(list[0]["status_since"], Value::Null);
    assert_eq!(list[1]["pane_id"], "w1:p2");
    assert_eq!(list[1]["source"], "screen");
    assert_eq!(list[1]["question"], "Would you like to run `rm -rf build`?");
}

#[tokio::test]
async fn rpc_filters_by_pane_ids() {
    let dir = tempfile::tempdir().unwrap();
    let (sock, home) = fake_host(dir.path());
    let mut s = Session::start(sock, home);
    let r = s.call("agents.preview", json!({"pane_ids": ["w1:p1"]})).await;
    let list = r["result"]["previews"].as_array().unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0]["pane_id"], "w1:p1");
    let bad = s.call("agents.preview", json!({"pane_ids": "w1:p1"})).await;
    assert_eq!(bad["error"]["code"], "bad_request");
}

#[tokio::test]
async fn rpc_without_herdr_is_an_error() {
    let dir = tempfile::tempdir().unwrap();
    let mut s = Session::start(dir.path().join("missing.sock"), dir.path().to_path_buf());
    let r = s.call("agents.preview", json!({})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}
