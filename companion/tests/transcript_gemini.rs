//! Gemini CLI sessions: the JSON-lines records, items, pages, follow, find by cwd and the older
//! formats. All fixtures are synthetic.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use herdlingd::transcript::{self, gemini, Agent};
use herdlingd::types::ThreadItem;
use serde_json::{json, Value};

const CWD: &str = "/home/sam/web-app";

fn lines(v: &[Value]) -> String {
    v.iter().map(|l| l.to_string() + "\n").collect()
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn append(path: &Path, v: &Value) {
    let mut t = std::fs::read_to_string(path).unwrap();
    t.push_str(&(v.to_string() + "\n"));
    std::fs::write(path, t).unwrap();
}

/// A project folder `web-app` registered for `cwd`, as Gemini CLI makes it.
fn project(home: &Path, cwd: &str) -> PathBuf {
    let dir = gemini::tmp_root(home).join("web-app");
    write(&dir.join(".project_root"), cwd);
    write(&gemini::root(home).join("projects.json"), &json!({"projects": {cwd: "web-app"}}).to_string());
    dir
}

fn meta(id: &str) -> Value {
    json!({"sessionId": id, "projectHash": "abc123", "startTime": "2026-10-01T10:00:00.000Z", "lastUpdated": "2026-10-01T10:00:00.000Z", "kind": "main"})
}

fn records(id: &str) -> Vec<Value> {
    vec![
        meta(id),
        json!({"id":"m1","timestamp":"2026-10-01T10:00:01.000Z","type":"user",
            "content":[{"text":"Fix the header"},{"text":"--- file text ---"}],"displayContent":[{"text":"Fix the header @src/header.tsx"}]}),
        json!({"id":"m2","timestamp":"2026-10-01T10:00:02.000Z","type":"gemini","content":"",
            "thoughts":[{"subject":"Plan","description":"Read the file first.","timestamp":"2026-10-01T10:00:02.000Z"}]}),
        // The same message again, now with text and a running tool call.
        json!({"id":"m2","timestamp":"2026-10-01T10:00:02.000Z","type":"gemini","content":"I will read the file.",
            "thoughts":[{"subject":"Plan","description":"Read the file first.","timestamp":"2026-10-01T10:00:02.000Z"}],
            "toolCalls":[{"id":"call-1","name":"read_file","args":{"file_path":"src/header.tsx"},"status":"executing","timestamp":"2026-10-01T10:00:03.000Z"}]}),
        // The tool response as a user message: not a prompt.
        json!({"id":"m3","timestamp":"2026-10-01T10:00:04.000Z","type":"user",
            "content":[{"functionResponse":{"id":"call-1","name":"read_file","response":{"output":"export function Header() {}"}}}]}),
        json!({"id":"m4","timestamp":"2026-10-01T10:00:05.000Z","type":"user","content":"<session_context>cwd info</session_context>"}),
        json!({"id":"m5","timestamp":"2026-10-01T10:00:06.000Z","type":"info","content":"Switched to a faster model."}),
        json!({"$set": {"summary": "Header fix", "lastUpdated": "2026-10-01T10:00:06.000Z"}}),
    ]
}

fn kinds(items: &[ThreadItem]) -> Vec<&'static str> {
    items
        .iter()
        .map(|i| match i {
            ThreadItem::User { .. } => "user",
            ThreadItem::Assistant { .. } => "assistant",
            ThreadItem::Thinking { .. } => "thinking",
            ThreadItem::Tool { .. } => "tool",
            ThreadItem::System { .. } => "system",
            ThreadItem::Subagent { .. } => "subagent",
        })
        .collect()
}

#[test]
fn records_become_thread_items() {
    let s = gemini::parse(&lines(&records("s-1")));
    assert_eq!(s.session_id(), Some("s-1"));
    assert_eq!(s.meta["summary"], "Header fix");
    let items = gemini::items(&s);
    assert_eq!(kinds(&items), ["user", "thinking", "assistant", "tool", "system"]);
    match &items[0] {
        // The text as typed, not the expanded file text.
        ThreadItem::User { text, .. } => assert_eq!(text, "Fix the header @src/header.tsx"),
        other => panic!("{other:?}"),
    }
    match &items[1] {
        ThreadItem::Thinking { text: Some(t), id, .. } => {
            assert_eq!(t, "Plan\nRead the file first.");
            assert_eq!(id, "m2:think");
        }
        other => panic!("{other:?}"),
    }
    match &items[3] {
        ThreadItem::Tool { id, name, input_summary, result, .. } => {
            assert_eq!((id.as_str(), name.as_str(), input_summary.as_str()), ("call-1", "read_file", "src/header.tsx"));
            assert!(result.is_none(), "still running");
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn patches_rewinds_and_order() {
    let mut r = records("s-1");
    r.push(json!({"$patch": {"id": "m2", "toolCalls": [{"id": "call-1", "status": "success",
        "result": [{"functionResponse": {"id": "call-1", "name": "read_file", "response": {"output": "export function Header() {}"}}}]}]}}));
    let items = gemini::items(&gemini::parse(&lines(&r)));
    match items.iter().find(|i| matches!(i, ThreadItem::Tool { .. })).unwrap() {
        ThreadItem::Tool { result: Some(res), .. } => assert_eq!((res.ok, res.text.as_str()), (true, "export function Header() {}")),
        other => panic!("{other:?}"),
    }

    // A failed call and `resultDisplay` text.
    r.push(json!({"$patch": {"id": "m2", "toolCalls": [{"id": "call-1", "status": "error", "resultDisplay": "File not found"}]}}));
    let items = gemini::items(&gemini::parse(&lines(&r)));
    match items.iter().find(|i| matches!(i, ThreadItem::Tool { .. })).unwrap() {
        ThreadItem::Tool { result: Some(res), .. } => assert_eq!((res.ok, res.text.as_str()), (false, "File not found")),
        other => panic!("{other:?}"),
    }

    // Rewind to m2: m2 and every later message go.
    r.push(json!({"$rewindTo": "m2"}));
    let items = gemini::items(&gemini::parse(&lines(&r)));
    assert_eq!(kinds(&items), ["user"]);

    // removeIds and orderIds.
    let mut r = records("s-1");
    r.push(json!({"$patch": {"removeIds": ["m5"], "orderIds": ["m1"]}}));
    let s = gemini::parse(&lines(&r));
    let ids: Vec<&str> = s.messages.iter().filter_map(|m| m["id"].as_str()).collect();
    assert_eq!(ids, ["m2", "m3", "m4", "m1"]);
}

#[test]
fn older_single_object_files() {
    let obj = json!({"sessionId": "old-1", "projectHash": "abc", "startTime": "2026-01-01T00:00:00Z", "lastUpdated": "2026-01-01T00:00:00Z",
        "messages": [
            {"id": "u1", "timestamp": "2026-01-01T00:00:01Z", "type": "user", "content": "Hello there"},
            {"id": "g1", "timestamp": "2026-01-01T00:00:02Z", "type": "gemini", "content": "Hi."}
        ]});
    let s = gemini::parse(&serde_json::to_string_pretty(&obj).unwrap());
    assert_eq!(s.session_id(), Some("old-1"));
    assert_eq!(kinds(&gemini::items(&s)), ["user", "assistant"]);
}

fn session(home: &Path, name: &str, id: &str) -> PathBuf {
    let dir = project(home, CWD);
    let log = dir.join("chats").join(name);
    write(&log, &lines(&records(id)));
    log
}

#[test]
fn pages_count_items_and_route_by_path() {
    let home = tempfile::tempdir().unwrap();
    let log = session(home.path(), "session-2026-10-01T10-00-s1.jsonl", "s-1");
    let l = log.to_string_lossy().to_string();
    assert_eq!(Agent::of_log(&l), Agent::Gemini);
    assert_eq!(Agent::from_kind("gemini"), Some(Agent::Gemini));
    assert!(transcript::KINDS.contains(&"gemini"));

    let page = transcript::thread_get(&l, None, 2).unwrap();
    assert_eq!(kinds(&page.items), ["tool", "system"]);
    assert_eq!(page.cursor, Some(3));
    assert_eq!(page.end, std::fs::metadata(&log).unwrap().len());
    let older = transcript::thread_get(&l, page.cursor, 10).unwrap();
    assert_eq!(kinds(&older.items), ["user", "thinking", "assistant"]);
    assert_eq!(older.cursor, None);
}

#[test]
fn follow_sends_new_and_changed_items() {
    let home = tempfile::tempdir().unwrap();
    let log = session(home.path(), "session-2026-10-01T10-00-s1.jsonl", "s-1");
    let l = log.to_string_lossy().to_string();
    let page = transcript::thread_get(&l, None, 50).unwrap();
    let mut f = transcript::Follower::new(&l, page.end).unwrap();
    assert!(f.poll().unwrap().is_none_or(|(items, _)| items.is_empty()));

    // The tool call finishes: the tool item comes again with its result.
    append(&log, &json!({"$patch": {"id": "m2", "toolCalls": [{"id": "call-1", "status": "success", "resultDisplay": "Read 12 lines."}]}}));
    let (items, offset) = f.poll().unwrap().unwrap();
    assert_eq!(offset, std::fs::metadata(&log).unwrap().len());
    assert!(matches!(&items[..], [ThreadItem::Tool { id, result: Some(_), .. }] if id == "call-1"), "{items:?}");

    // A new reply.
    append(&log, &json!({"id":"m6","timestamp":"2026-10-01T10:00:09.000Z","type":"gemini","content":"Done."}));
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Assistant { markdown, .. }] if markdown == "Done."), "{items:?}");
    assert!(f.poll().unwrap().is_none());
}

#[test]
fn follow_from_an_older_end_sends_what_came_after() {
    let home = tempfile::tempdir().unwrap();
    let log = session(home.path(), "session-2026-10-01T10-00-s1.jsonl", "s-1");
    let l = log.to_string_lossy().to_string();
    let end = transcript::thread_get(&l, None, 50).unwrap().end;
    // Written between the page read and the follow start.
    append(&log, &json!({"id":"m6","timestamp":"2026-10-01T10:00:09.000Z","type":"gemini","content":"Late reply."}));
    let mut f = transcript::Follower::new(&l, end).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Assistant { markdown, .. }] if markdown == "Late reply."), "{items:?}");
}

#[test]
fn finds_sessions_by_cwd_and_lists_them() {
    let home = tempfile::tempdir().unwrap();
    let old = session(home.path(), "session-2026-10-01T09-00-s0.jsonl", "s-0");
    let new = session(home.path(), "session-2026-10-01T10-00-s1.jsonl", "s-1");
    let t = SystemTime::now();
    std::fs::File::options().write(true).open(&old).unwrap().set_modified(t - std::time::Duration::from_secs(3600)).unwrap();
    std::fs::File::options().write(true).open(&new).unwrap().set_modified(t).unwrap();

    let found = transcript::locate(home.path(), Agent::Gemini, CWD, None, SystemTime::now()).unwrap();
    assert_eq!((found.id.as_str(), found.log_path.as_str()), ("s-1", new.to_string_lossy().as_ref()));

    let recent = transcript::recent_sessions(home.path(), "gemini", CWD, 10);
    assert_eq!(recent.iter().map(|r| r.session.as_str()).collect::<Vec<_>>(), ["s-1", "s-0"]);
    assert_eq!(recent[0].first_prompt, "Header fix");
    assert_eq!(recent[0].cwd, CWD);
    assert!(transcript::recent_cwds(home.path(), 10).contains(&CWD.to_string()));
    assert!(transcript::recent_sessions(home.path(), "gemini", "/home/sam/other", 10).is_empty());
}

#[test]
fn finds_the_older_sha256_folder() {
    let home = tempfile::tempdir().unwrap();
    // Older Gemini CLI versions named the folder after the SHA-256 of the cwd.
    use sha2::{Digest, Sha256};
    let hex: String = Sha256::digest(b"/home/sam/legacy").iter().map(|b| format!("{b:02x}")).collect();
    let log = gemini::tmp_root(home.path()).join(&hex).join("chats").join("session-1.json");
    let obj = json!({"sessionId": "legacy-1", "projectHash": hex, "startTime": "x", "lastUpdated": "x",
        "messages": [{"id": "u1", "timestamp": "2026-01-01T00:00:01Z", "type": "user", "content": "Old prompt"}]});
    write(&log, &obj.to_string());
    let recent = transcript::recent_sessions(home.path(), "gemini", "/home/sam/legacy", 10);
    assert_eq!(recent.len(), 1);
    assert_eq!((recent[0].session.as_str(), recent[0].first_prompt.as_str()), ("legacy-1", "Old prompt"));
}
