//! Pi session logs: branch selection, parse, follow, find by cwd, recent sessions.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use herdlingd::transcript::{self, pi, Agent};
use herdlingd::types::ThreadItem;
use serde_json::{json, Value};

const CWD: &str = "/home/sam/project";

fn header(id: &str, cwd: &str) -> Value {
    json!({"type":"session","version":3,"id":id,"timestamp":"2026-10-01T10:00:00.000Z","cwd":cwd})
}

fn entry(id: &str, parent: Option<&str>, kind: &str, extra: Value) -> Value {
    let mut v = json!({"type": kind, "id": id, "parentId": parent, "timestamp": "2026-10-01T10:00:01.000Z"});
    for (k, x) in extra.as_object().unwrap() {
        v[k] = x.clone();
    }
    v
}

fn user(id: &str, parent: Option<&str>, text: &str) -> Value {
    entry(id, parent, "message", json!({"message": {"role":"user","content":[{"type":"text","text":text}],"timestamp":1}}))
}

fn reply(id: &str, parent: &str, text: &str) -> Value {
    entry(id, Some(parent), "message", json!({"message": {"role":"assistant","content":[{"type":"text","text":text}],"stopReason":"stop","timestamp":1}}))
}

fn lines(v: &[Value]) -> String {
    v.iter().map(|l| l.to_string() + "\n").collect()
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

fn log(home: &Path, name: &str) -> PathBuf {
    pi::project_dir(home, CWD).join(format!("2026-10-01T10-00-00-000Z_{name}.jsonl"))
}

fn texts(items: &[ThreadItem]) -> Vec<String> {
    items
        .iter()
        .map(|i| match i {
            ThreadItem::User { text, .. } => format!("u:{text}"),
            ThreadItem::Assistant { markdown, .. } => format!("a:{markdown}"),
            ThreadItem::Thinking { text, .. } => format!("t:{}", text.clone().unwrap_or_default()),
            ThreadItem::Tool { name, result, .. } => format!("tool:{name}:{}", result.as_ref().map_or("open", |r| if r.ok { "ok" } else { "err" })),
            ThreadItem::System { text, .. } => format!("s:{text}"),
            ThreadItem::Subagent { .. } => "sub".into(),
        })
        .collect()
}

#[test]
fn project_dir_encoding() {
    let p = pi::project_dir(Path::new("/h"), "/home/sam/my.proj/x");
    assert_eq!(p, Path::new("/h/.pi/agent/sessions/--home-sam-my.proj-x--"));
}

#[test]
fn page_shows_only_the_current_branch() {
    let dir = tempfile::tempdir().unwrap();
    let path = log(dir.path(), "a");
    // root -> u1 -> a1 -> u2 -> a2 (old branch); the user went back to a1 and asked u3.
    write(
        &path,
        &lines(&[
            header("s-1", CWD),
            entry("m0", None, "model_change", json!({"provider":"p","modelId":"m"})),
            user("u1", Some("m0"), "first"),
            reply("a1", "u1", "one"),
            user("u2", Some("a1"), "old question"),
            reply("a2", "u2", "old answer"),
            entry("b1", Some("a1"), "branch_summary", json!({"fromId":"a2","summary":"tried X"})),
            user("u3", Some("b1"), "new question"),
            reply("a3", "u3", "new answer"),
        ]),
    );
    assert_eq!(Agent::of_log(&path.to_string_lossy()), Agent::Pi);
    let page = transcript::thread_get(&path.to_string_lossy(), None, 50).unwrap();
    assert_eq!(texts(&page.items), ["u:first", "a:one", "s:Branch summary: tried X", "u:new question", "a:new answer"]);
    let (set, leaf) = pi::branch(&path).unwrap();
    assert_eq!(leaf.as_deref(), Some("a3"));
    assert!(!set.contains("u2"));
}

#[test]
fn parse_tools_thinking_and_notes() {
    let dir = tempfile::tempdir().unwrap();
    let path = log(dir.path(), "b");
    let call = entry("a1", Some("u1"), "message", json!({"message": {"role":"assistant","stopReason":"toolUse","content":[
        {"type":"thinking","thinking":"Check files"},
        {"type":"thinking","thinking":""},
        {"type":"toolCall","id":"call_1","name":"bash","arguments":{"command":"ls src"}},
        {"type":"toolCall","id":"call_2","name":"read","arguments":{"path":"src/a.ts"}}]}}));
    write(
        &path,
        &lines(&[
            header("s-2", CWD),
            user("u1", None, "list files"),
            call,
            entry("r1", Some("a1"), "message", json!({"message":{"role":"toolResult","toolCallId":"call_1","toolName":"bash","content":[{"type":"text","text":"a.ts"}],"isError":false}})),
            entry("r2", Some("r1"), "message", json!({"message":{"role":"toolResult","toolCallId":"call_2","toolName":"read","content":[{"type":"text","text":"no such file"}],"isError":true}})),
            entry("c1", Some("r2"), "custom_message", json!({"customType":"x","content":"hidden note","display":false})),
            entry("c2", Some("c1"), "custom_message", json!({"customType":"x","content":"Shown note","display":true})),
            entry("k1", Some("c2"), "compaction", json!({"summary":"Earlier work","tokensBefore":10})),
            entry("x1", Some("k1"), "message", json!({"message":{"role":"bashExecution","command":"git status","output":"clean","exitCode":0,"cancelled":false,"truncated":false}})),
            entry("e1", Some("x1"), "message", json!({"message":{"role":"assistant","content":[],"stopReason":"aborted","errorMessage":"Operation aborted"}})),
            entry("i1", Some("e1"), "session_info", json!({"name":"Tidy src"})),
        ]),
    );
    let page = transcript::thread_get(&path.to_string_lossy(), None, 50).unwrap();
    assert_eq!(
        texts(&page.items),
        [
            "u:list files",
            "t:Check files",
            "tool:bash:ok",
            "tool:read:err",
            "s:Shown note",
            "s:Conversation compacted. Earlier work",
            "tool:bash:ok",
            "s:Interrupted",
        ]
    );
    match &page.items[2] {
        ThreadItem::Tool { id, input_summary, .. } => assert_eq!((id.as_str(), input_summary.as_str()), ("call_1", "ls src")),
        other => panic!("{other:?}"),
    }
    let list = transcript::recent_sessions(dir.path(), "pi", CWD, 5);
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].session, "s-2");
    assert_eq!(list[0].first_prompt, "Tidy src", "the session name wins over the first prompt");
}

#[test]
fn follow_emits_new_entries_and_ends_on_a_branch_change() {
    let dir = tempfile::tempdir().unwrap();
    let path = log(dir.path(), "c");
    let mut text = lines(&[header("s-3", CWD), user("u1", None, "hi"), reply("a1", "u1", "hello")]);
    write(&path, &text);
    let mut f = transcript::Follower::new(&path.to_string_lossy(), text.len() as u64).unwrap();
    assert!(f.poll().unwrap().is_none());
    text += &lines(&[user("u2", Some("a1"), "more"), reply("a2", "u2", "sure")]);
    std::fs::write(&path, &text).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(texts(&items), ["u:more", "a:sure"]);
    assert_eq!(f.ended(), None);
    // The user goes back to a1 in the tree and asks again.
    text += &lines(&[user("u3", Some("a1"), "other way")]);
    std::fs::write(&path, &text).unwrap();
    let _ = f.poll().unwrap();
    assert_eq!(f.ended(), Some("branch_changed"));
}

#[test]
fn follow_gets_results_for_calls_before_the_start() {
    let dir = tempfile::tempdir().unwrap();
    let path = log(dir.path(), "d");
    let call = entry("a1", Some("u1"), "message", json!({"message": {"role":"assistant","content":[{"type":"toolCall","id":"call_9","name":"bash","arguments":{"command":"sleep 1"}}]}}));
    let mut text = lines(&[header("s-4", CWD), user("u1", None, "wait"), call]);
    write(&path, &text);
    let mut f = transcript::Follower::new(&path.to_string_lossy(), text.len() as u64).unwrap();
    text += &lines(&[entry("r1", Some("a1"), "message", json!({"message":{"role":"toolResult","toolCallId":"call_9","content":[{"type":"text","text":""}],"isError":false}}))]);
    std::fs::write(&path, &text).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(texts(&items), ["tool:bash:ok"]);
    assert_eq!(f.ended(), None);
}

#[test]
fn locate_and_recent_folders() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let now = SystemTime::now();
    let old = log(home, "old");
    let new = log(home, "new");
    write(&old, &lines(&[header("old", CWD), user("u1", None, "a")]));
    write(&new, &lines(&[header("new", CWD), user("u1", None, "b")]));
    // A file in the folder whose header names another cwd is not this folder's.
    let stray = log(home, "stray");
    write(&stray, &lines(&[header("stray", "/home/sam/other"), user("u1", None, "c")]));
    std::fs::File::options().write(true).open(&old).unwrap().set_modified(now - Duration::from_secs(600)).unwrap();
    std::fs::File::options().write(true).open(&new).unwrap().set_modified(now - Duration::from_secs(20)).unwrap();
    std::fs::File::options().write(true).open(&stray).unwrap().set_modified(now).unwrap();
    let found = transcript::locate(home, Agent::Pi, CWD, Some(now - Duration::from_secs(60)), now).unwrap();
    assert_eq!(found.id, "new");
    let ids: Vec<String> = transcript::recent_sessions(home, "pi", CWD, 10).into_iter().map(|s| s.session).collect();
    assert_eq!(ids, ["new", "old"]);
    assert_eq!(transcript::recent_cwds(home, 10), ["/home/sam/other"]);
}
