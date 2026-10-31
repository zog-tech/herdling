//! omp (oh-my-pi) session logs: folder names, the omp additions to the Pi format, find by cwd,
//! recent sessions and follow. All fixtures are synthetic.

use std::path::{Path, PathBuf};
use std::time::SystemTime;

use herdlingd::transcript::{self, omp, Agent};
use herdlingd::types::ThreadItem;
use serde_json::{json, Value};

fn lines(v: &[Value]) -> String {
    v.iter().map(|l| l.to_string() + "\n").collect()
}

fn write(path: &Path, text: &str) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
}

/// The fixed-width title line that omp writes before the header.
fn title(t: &str) -> Value {
    json!({"type":"title","v":1,"title":t,"source":"auto","updatedAt":"2026-10-01T10:00:00.000Z","pad":"    "})
}

fn header(id: &str, cwd: &str) -> Value {
    json!({"type":"session","version":3,"id":id,"timestamp":"2026-10-01T10:00:00.000Z","cwd":cwd})
}

fn entry(id: &str, parent: Option<&str>, message: Value) -> Value {
    json!({"type":"message","id":id,"parentId":parent,"timestamp":"2026-10-01T10:00:01.000Z","message":message})
}

fn session_lines(cwd: &str) -> Vec<Value> {
    vec![
        title("Fix the parser"),
        header("019a0000-0000-7000-8000-000000000001", cwd),
        entry("a1", None, json!({"role":"developer","content":"internal rules"})),
        entry("a2", Some("a1"), json!({"role":"user","content":"reminder","synthetic":true})),
        entry("a3", Some("a2"), json!({"role":"user","content":[{"type":"text","text":"Fix the parser"}]})),
        entry("a4", Some("a3"), json!({"role":"fileMention","files":[{"path":"src/parse.rs","content":"fn x() {}"}]})),
        entry("a5", Some("a4"), json!({"role":"assistant","content":[
            {"type":"redactedThinking","data":"xyz"},
            {"type":"text","text":"Running the tests."},
            {"type":"toolCall","id":"c1","name":"bash","arguments":{"command":"cargo test"}}
        ],"stopReason":"toolUse"})),
        entry("a6", Some("a5"), json!({"role":"toolResult","toolCallId":"c1","toolName":"bash","content":[{"type":"text","text":"ok"}],"isError":false})),
        entry("a7", Some("a6"), json!({"role":"pythonExecution","code":"print(1)","output":"1","exitCode":0})),
    ]
}

#[test]
fn folder_names() {
    let home = Path::new("/home/sam");
    let tmp = Path::new("/tmp");
    assert_eq!(omp::dir_name(home, tmp, Path::new("/home/sam/Coding/foo")), "-Coding-foo");
    assert_eq!(omp::dir_name(home, tmp, Path::new("/home/sam")), "-");
    assert_eq!(omp::dir_name(home, tmp, Path::new("/tmp/x/y")), "-tmp-x-y");
    assert_eq!(omp::dir_name(home, tmp, Path::new("/srv/app")), "--srv-app--");
    assert_eq!(omp::dir_name(home, tmp, Path::new("/srv/a:b")), "--srv-a-b--");
}

#[test]
fn omp_logs_route_to_the_pi_parser_with_the_omp_additions() {
    let home = tempfile::tempdir().unwrap();
    let log = omp::sessions_root(home.path()).join("-p").join("2026-10-01T10-00-00-000Z_019a.jsonl");
    write(&log, &lines(&session_lines("/home/sam/p")));
    let l = log.to_string_lossy().to_string();
    assert_eq!(Agent::of_log(&l), Agent::Omp);
    assert_eq!(Agent::from_kind("omp"), Some(Agent::Omp));
    assert!(transcript::KINDS.contains(&"omp"));

    let page = transcript::thread_get(&l, None, 50).unwrap();
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
    // No developer and no synthetic user message.
    assert_eq!(kinds, ["user", "system", "thinking", "assistant", "tool", "tool"]);
    match &page.items[1] {
        ThreadItem::System { text, .. } => assert_eq!(text, "Attached src/parse.rs"),
        other => panic!("{other:?}"),
    }
    match &page.items[4] {
        ThreadItem::Tool { name, result: Some(r), .. } => assert_eq!((name.as_str(), r.text.as_str(), r.ok), ("bash", "ok", true)),
        other => panic!("{other:?}"),
    }
    match &page.items[5] {
        ThreadItem::Tool { name, input_summary, result: Some(r), .. } => {
            assert_eq!((name.as_str(), input_summary.as_str(), r.text.as_str()), ("python", "print(1)", "1"))
        }
        other => panic!("{other:?}"),
    }
}

#[test]
fn the_active_leaf_picks_the_branch() {
    let home = tempfile::tempdir().unwrap();
    let log = omp::sessions_root(home.path()).join("-p").join("s.jsonl");
    let mut v = vec![
        header("s1", "/home/sam/p"),
        entry("b1", None, json!({"role":"user","content":"first"})),
        entry("b2", Some("b1"), json!({"role":"assistant","content":[{"type":"text","text":"kept"}]})),
        entry("b3", Some("b1"), json!({"role":"assistant","content":[{"type":"text","text":"other branch"}]})),
    ];
    // The last entry is off the active branch: it names the leaf b2.
    v[3]["activeLeafId"] = json!("b2");
    write(&log, &lines(&v));
    let page = transcript::thread_get(&log.to_string_lossy(), None, 50).unwrap();
    let texts: Vec<String> = page
        .items
        .iter()
        .filter_map(|i| match i {
            ThreadItem::Assistant { markdown, .. } => Some(markdown.clone()),
            _ => None,
        })
        .collect();
    assert_eq!(texts, ["kept"]);
}

fn omp_session(home: &Path, cwd: &Path, id: &str) -> PathBuf {
    let dir = omp::project_dirs(home, &cwd.to_string_lossy())[0].clone();
    let log = dir.join(format!("2026-10-01T10-00-00-000Z_{id}.jsonl"));
    let mut v = session_lines(&cwd.canonicalize().unwrap().to_string_lossy());
    v[1]["id"] = json!(id);
    write(&log, &lines(&v));
    log
}

#[test]
fn finds_sessions_by_cwd_and_lists_them() {
    let home = tempfile::tempdir().unwrap();
    let cwd = home.path().join("proj");
    std::fs::create_dir_all(&cwd).unwrap();
    let log = omp_session(home.path(), &cwd, "019a-1");
    let c = cwd.to_string_lossy().to_string();

    let found = transcript::locate(home.path(), Agent::Omp, &c, None, SystemTime::now()).unwrap();
    assert_eq!(found.id, "019a-1");
    assert_eq!(found.log_path, log.to_string_lossy());

    let recent = transcript::recent_sessions(home.path(), "omp", &c, 10);
    assert_eq!(recent.len(), 1);
    assert_eq!(recent[0].session, "019a-1");
    // The title line names the session.
    assert_eq!(recent[0].first_prompt, "Fix the parser");
    assert!(transcript::recent_cwds(home.path(), 10).iter().any(|r| Path::new(r).canonicalize().ok() == cwd.canonicalize().ok()));

    // An older omp wrote the Pi folder name. It is read too.
    let other = home.path().join("other");
    std::fs::create_dir_all(&other).unwrap();
    let o = other.to_string_lossy().to_string();
    let old_dir = omp::project_dirs(home.path(), &o)[1].clone();
    assert!(old_dir.file_name().unwrap().to_string_lossy().starts_with("--"));
    let mut v = session_lines(&o);
    v[1]["id"] = json!("old-1");
    write(&old_dir.join("old.jsonl"), &lines(&v));
    assert_eq!(transcript::recent_sessions(home.path(), "omp", &o, 10)[0].session, "old-1");
}

#[test]
fn follow_sends_new_entries() {
    let home = tempfile::tempdir().unwrap();
    let cwd = home.path().join("proj");
    std::fs::create_dir_all(&cwd).unwrap();
    let log = omp_session(home.path(), &cwd, "019a-2");
    let l = log.to_string_lossy().to_string();
    let page = transcript::thread_get(&l, None, 50).unwrap();
    let mut f = transcript::Follower::new(&l, page.end).unwrap();
    assert!(f.poll().unwrap().is_none());
    let more = entry("a8", Some("a7"), json!({"role":"assistant","content":[{"type":"text","text":"All green."}]}));
    let mut text = std::fs::read_to_string(&log).unwrap();
    text.push_str(&(more.to_string() + "\n"));
    std::fs::write(&log, text).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert!(matches!(&items[..], [ThreadItem::Assistant { markdown, .. }] if markdown == "All green."), "{items:?}");
}
