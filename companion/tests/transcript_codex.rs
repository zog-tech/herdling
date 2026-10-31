//! Codex rollout logs: parse, pages, follow, find by cwd, recent sessions.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use herdlingd::transcript::jsonl::{self, Follower, LineParser};
use herdlingd::transcript::{self, codex, Agent};
use herdlingd::types::ThreadItem;
use serde_json::{json, Value};

const CWD: &str = "/home/sam/project";

fn meta(id: &str, cwd: &str) -> Value {
    json!({"timestamp":"2026-10-01T10:00:00.000Z","type":"session_meta","payload":{"id":id,"cwd":cwd,"originator":"codex-tui","source":"cli"}})
}

fn ri(ts: &str, payload: Value) -> Value {
    json!({"timestamp": ts, "type": "response_item", "payload": payload})
}

fn ev(ts: &str, payload: Value) -> Value {
    json!({"timestamp": ts, "type": "event_msg", "payload": payload})
}

fn lines(v: &[Value]) -> String {
    v.iter().map(|l| l.to_string() + "\n").collect()
}

fn basic() -> Vec<Value> {
    vec![
        meta("s-1", CWD),
        ri("2026-10-01T10:00:01.000Z", json!({"type":"message","role":"developer","content":[{"type":"input_text","text":"<permissions instructions>x"}]})),
        ri("2026-10-01T10:00:01.000Z", json!({"type":"message","id":"m0","role":"user",
            "content":[{"type":"input_text","text":"# AGENTS.md instructions\nrules"},{"type":"input_text","text":"<environment_context>cwd</environment_context>"}],
            "internal_chat_message_metadata_passthrough":{"content_item_kinds":["agents_md.instructions","environments.environment_context"]}})),
        ri("2026-10-01T10:00:02.000Z", json!({"type":"message","id":"m1","role":"user",
            "content":[{"type":"input_text","text":"Fix the failing test"},{"type":"input_image","image_url":"data:"}],
            "internal_chat_message_metadata_passthrough":{"content_item_kinds":["user.text","user.image"]}})),
        // The same prompt as an event: not shown a second time.
        ev("2026-10-01T10:00:02.000Z", json!({"type":"user_message","message":"Fix the failing test","images":[]})),
        ri("2026-10-01T10:00:03.000Z", json!({"type":"reasoning","id":"r1","summary":[],"encrypted_content":"x"})),
        ri("2026-10-01T10:00:03.500Z", json!({"type":"reasoning","id":"r2","summary":[{"type":"summary_text","text":"Look at the test"}]})),
        ri("2026-10-01T10:00:04.000Z", json!({"type":"message","id":"a1","role":"assistant","phase":"commentary","content":[{"type":"output_text","text":"I will run the tests."}]})),
        ri("2026-10-01T10:00:05.000Z", json!({"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"pnpm test\",\"workdir\":\"/home/sam/project\"}","call_id":"c1"})),
        ri("2026-10-01T10:00:06.000Z", json!({"type":"function_call_output","call_id":"c1","output":"Exit code: 1\nWall time: 1 seconds\nOutput:\nFAIL"})),
        ri("2026-10-01T10:00:07.000Z", json!({"type":"custom_tool_call","status":"completed","call_id":"c2","name":"apply_patch","input":"*** Begin Patch\n*** Update File: src/a.ts\n@@\n-x\n+y\n*** End Patch"})),
        ri("2026-10-01T10:00:08.000Z", json!({"type":"custom_tool_call_output","call_id":"c2","output":[{"type":"input_text","text":"Success."}]})),
        ri("2026-10-01T10:00:09.000Z", json!({"type":"web_search_call","id":"w1","status":"completed","action":{"type":"search","query":"vitest config"}})),
        ri("2026-10-01T10:00:10.000Z", json!({"type":"message","id":"a2","role":"assistant","phase":"final_answer","content":[{"type":"output_text","text":"Done. The test passes."}]})),
        ev("2026-10-01T10:00:11.000Z", json!({"type":"turn_aborted","reason":"interrupted"})),
        ev("2026-10-01T10:00:12.000Z", json!({"type":"context_compacted"})),
        json!({"timestamp":"2026-10-01T10:00:13.000Z","type":"token_usage_record","payload":{}}),
    ]
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn rollout(home: &Path, name: &str) -> PathBuf {
    codex::sessions_root(home).join("2026/10/01").join(format!("rollout-{name}.jsonl"))
}

#[test]
fn page_maps_lines_to_items() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "a");
    write(&path, &lines(&basic()));
    assert_eq!(Agent::of_log(&path.to_string_lossy()), Agent::Codex);
    let page = transcript::thread_get(&path.to_string_lossy(), None, 100).unwrap();
    let kinds: Vec<&str> = page
        .items
        .iter()
        .map(|i| match i {
            ThreadItem::User { .. } => "user",
            ThreadItem::Assistant { .. } => "assistant",
            ThreadItem::Thinking { .. } => "thinking",
            ThreadItem::Tool { .. } => "tool",
            ThreadItem::System { .. } => "system",
            ThreadItem::Subagent { .. } => "subagent",
        })
        .collect();
    assert_eq!(kinds, ["user", "thinking", "assistant", "tool", "tool", "tool", "assistant", "system", "system"]);
    match &page.items[0] {
        ThreadItem::User { id, text, images, ts } => {
            assert_eq!(id, "m1");
            assert_eq!(text, "Fix the failing test");
            assert_eq!(*images, Some(1));
            assert!(*ts > 0);
        }
        other => panic!("{other:?}"),
    }
    match &page.items[3] {
        ThreadItem::Tool { id, name, input_summary, result, .. } => {
            assert_eq!((id.as_str(), name.as_str(), input_summary.as_str()), ("c1", "exec_command", "pnpm test"));
            let r = result.as_ref().unwrap();
            assert!(!r.ok, "exit code 1 is a failure");
            assert!(r.text.contains("FAIL"));
        }
        other => panic!("{other:?}"),
    }
    match &page.items[4] {
        ThreadItem::Tool { name, input_summary, result, .. } => {
            assert_eq!((name.as_str(), input_summary.as_str()), ("apply_patch", "src/a.ts"));
            assert_eq!(result.as_ref().unwrap().text, "Success.");
            assert!(result.as_ref().unwrap().ok);
        }
        other => panic!("{other:?}"),
    }
    match &page.items[5] {
        ThreadItem::Tool { name, input_summary, result, .. } => {
            assert_eq!((name.as_str(), input_summary.as_str()), ("web_search", "vitest config"));
            assert!(result.is_some());
        }
        other => panic!("{other:?}"),
    }
    assert!(matches!(&page.items[7], ThreadItem::System { text, .. } if text == "Interrupted"));
    assert!(matches!(&page.items[8], ThreadItem::System { text, .. } if text == "Conversation compacted"));
    assert_eq!(page.cursor, None);
    assert_eq!(page.end, std::fs::metadata(&path).unwrap().len());
}

#[test]
fn legacy_user_message_without_kinds_drops_injected_text() {
    let line = ri("2026-10-01T10:00:00.000Z", json!({"type":"message","role":"user",
        "content":[{"type":"input_text","text":"<environment_context>\n<cwd>/x</cwd>\n</environment_context>"},{"type":"input_text","text":"hello"}]}));
    let p = codex::Parser.parse(0, &line.to_string());
    assert!(matches!(&p.items[..], [ThreadItem::User { text, .. }] if text == "hello"));
    let only_ctx = ri("2026-10-01T10:00:00.000Z", json!({"type":"message","role":"user",
        "content":[{"type":"input_text","text":"# AGENTS.md instructions for /x"}]}));
    assert!(codex::Parser.parse(0, &only_ctx.to_string()).items.is_empty());
}

#[test]
fn exec_code_mode_summary_is_the_command() {
    let line = ri("2026-10-01T10:00:00.000Z", json!({"type":"custom_tool_call","call_id":"c9","name":"exec",
        "input":"const r = await tools.exec_command({\"cmd\":\"ls -la src\",\"yield_time_ms\":1000});"}));
    let p = codex::Parser.parse(0, &line.to_string());
    assert!(matches!(&p.items[..], [ThreadItem::Tool { input_summary, .. }] if input_summary == "ls -la src"));
}

#[test]
fn pages_go_back_and_find_results_on_later_pages() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "b");
    let mut v = vec![meta("s-2", CWD)];
    for i in 0..10 {
        v.push(ri("2026-10-01T10:00:00.000Z", json!({"type":"message","id":format!("a{i}"),"role":"assistant","content":[{"type":"output_text","text":format!("step {i}")}]})));
    }
    v.push(ri("2026-10-01T10:00:00.000Z", json!({"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"make\"}","call_id":"late"})));
    for i in 10..14 {
        v.push(ri("2026-10-01T10:00:00.000Z", json!({"type":"message","id":format!("a{i}"),"role":"assistant","content":[{"type":"output_text","text":format!("step {i}")}]})));
    }
    v.push(ri("2026-10-01T10:00:00.000Z", json!({"type":"function_call_output","call_id":"late","output":"Exit code: 0\nok"})));
    write(&path, &lines(&v));
    let log = path.to_string_lossy();
    let last = transcript::thread_get(&log, None, 4).unwrap();
    assert_eq!(last.items.len(), 4);
    let older = transcript::thread_get(&log, last.cursor, 4).unwrap();
    // The page that holds the call also gets its result from the later lines.
    let call = older.items.iter().chain(transcript::thread_get(&log, older.cursor, 4).unwrap().items.iter()).find_map(|i| match i {
        ThreadItem::Tool { id, result, .. } if id == "late" => Some(result.clone()),
        _ => None,
    });
    assert!(call.unwrap().unwrap().ok);
    // Walk to the start: every item comes once.
    let mut cursor = Some(last.end);
    let mut n = 0;
    while let Some(c) = cursor {
        let p = transcript::thread_get(&log, Some(c), 4).unwrap();
        n += p.items.len();
        cursor = p.cursor;
    }
    assert_eq!(n, 15);
}

#[test]
fn follow_emits_new_items_and_updates_tools() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "c");
    write(&path, &lines(&[meta("s-3", CWD)]));
    let end = std::fs::metadata(&path).unwrap().len();
    let mut f = Follower::new(&path, end, codex::Parser);
    assert!(f.poll().unwrap().is_none());
    let mut text = std::fs::read_to_string(&path).unwrap();
    text += &lines(&[ri("2026-10-01T10:00:05.000Z", json!({"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}","call_id":"c1"}))]);
    // A line still being written is not read yet.
    std::fs::write(&path, text.clone() + "{\"type\":\"respo").unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Tool { id, result: None, .. }] if id == "c1"));
    text += &lines(&[ri("2026-10-01T10:00:06.000Z", json!({"type":"function_call_output","call_id":"c1","output":"a\nb"}))]);
    std::fs::write(&path, &text).unwrap();
    let (items, offset) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Tool { id, result: Some(r), .. }] if id == "c1" && r.text == "a\nb"));
    assert_eq!(offset, text.len() as u64);
}

#[test]
fn follow_started_after_a_call_still_gets_its_result() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "d");
    let call = ri("2026-10-01T10:00:05.000Z", json!({"type":"function_call","name":"exec_command","arguments":"{\"cmd\":\"ls\"}","call_id":"c7"}));
    write(&path, &lines(&[meta("s-4", CWD), call]));
    let end = std::fs::metadata(&path).unwrap().len();
    let mut f = transcript::Follower::new(&path.to_string_lossy(), end).unwrap();
    let mut text = std::fs::read_to_string(&path).unwrap();
    text += &lines(&[ri("2026-10-01T10:00:06.000Z", json!({"type":"function_call_output","call_id":"c7","output":"done"}))]);
    std::fs::write(&path, &text).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Tool { id, result: Some(_), .. }] if id == "c7"));
}

fn set_mtime(path: &Path, t: SystemTime) {
    std::fs::File::options().write(true).open(path).unwrap().set_modified(t).unwrap();
}

#[test]
fn locate_picks_the_session_of_the_cwd_written_since_the_agent_start() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let now = SystemTime::now();
    let old = rollout(home, "old");
    let mine = rollout(home, "mine");
    let other = rollout(home, "other");
    let sub = rollout(home, "sub");
    write(&old, &lines(&[meta("old", CWD)]));
    write(&mine, &lines(&[meta("mine", CWD)]));
    write(&other, &lines(&[meta("other", "/home/sam/elsewhere")]));
    let mut sub_meta = meta("sub", CWD);
    sub_meta["payload"]["source"] = json!({"subagent": {"other": "review"}});
    write(&sub, &lines(&[sub_meta]));
    set_mtime(&old, now - Duration::from_secs(3600));
    set_mtime(&mine, now - Duration::from_secs(30));
    set_mtime(&other, now - Duration::from_secs(5));
    set_mtime(&sub, now - Duration::from_secs(1));

    let start = Some(now - Duration::from_secs(60));
    let found = transcript::locate(home, Agent::Codex, CWD, start, now).unwrap();
    assert_eq!(found.id, "mine");
    assert_eq!(found.log_path, mine.to_string_lossy());
    // The agent started after its folder's last write: no session yet.
    assert!(transcript::locate(home, Agent::Codex, CWD, Some(now), now).is_none());
    // Without a start, only recent activity counts.
    assert_eq!(transcript::locate(home, Agent::Codex, CWD, None, now).unwrap().id, "mine");

    let recent = transcript::recent_sessions(home, "codex", CWD, 10);
    let ids: Vec<&str> = recent.iter().map(|s| s.session.as_str()).collect();
    assert_eq!(ids, ["mine", "old"]);
    let cwds = transcript::recent_cwds(home, 10);
    assert_eq!(cwds, ["/home/sam/elsewhere", CWD]);
}

#[test]
fn recent_sessions_show_the_first_prompt() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "e");
    write(&path, &lines(&basic()));
    let list = transcript::recent_sessions(dir.path(), "codex", CWD, 5);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].session, "s-1");
    assert_eq!(list[0].first_prompt, "Fix the failing test");
    assert_eq!(list[0].cwd, CWD);
}

#[test]
fn partial_last_line_is_left_for_later() {
    let dir = tempfile::tempdir().unwrap();
    let path = rollout(dir.path(), "f");
    let text = lines(&basic()) + "{\"type\":\"response_item\",\"payload\":{\"type\":\"mess";
    write(&path, &text);
    let page = jsonl::page(&path, None, 100, &mut codex::Parser).unwrap();
    assert_eq!(page.end, lines(&basic()).len() as u64);
}
