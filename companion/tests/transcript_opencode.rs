//! OpenCode 2 SQLite sessions: pages, follow with changed rows, find by cwd, recent sessions.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use herdlingd::transcript::{self, opencode, Agent};
use herdlingd::types::ThreadItem;
use rusqlite::{params, Connection};
use serde_json::{json, Value};

const CWD: &str = "/home/sam/project";

/// A writer connection in WAL mode, like OpenCode's. The test keeps it open while reading.
fn create(home: &Path) -> (PathBuf, Connection) {
    let db = opencode::db_path(home);
    std::fs::create_dir_all(db.parent().unwrap()).unwrap();
    let c = Connection::open(&db).unwrap();
    c.execute_batch(
        "PRAGMA journal_mode=WAL;
         CREATE TABLE session_v2 (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, parent_id TEXT, slug TEXT NOT NULL,
           directory TEXT NOT NULL, title TEXT, version TEXT NOT NULL, time_created INTEGER NOT NULL,
           time_updated INTEGER NOT NULL, time_archived INTEGER, time_viewed INTEGER);
         CREATE TABLE session_message (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, type TEXT NOT NULL,
           seq INTEGER NOT NULL, time_created INTEGER NOT NULL, time_updated INTEGER NOT NULL, data TEXT NOT NULL);",
    )
    .unwrap();
    (db, c)
}

fn add_session(c: &Connection, id: &str, dir: &str, title: Option<&str>, updated: i64, viewed: Option<i64>, parent: Option<&str>) {
    c.execute(
        "INSERT INTO session_v2 (id, project_id, parent_id, slug, directory, title, version, time_created, time_updated, time_viewed)
         VALUES (?1, 'p', ?2, 's', ?3, ?4, '2.0.28', ?5, ?5, ?6)",
        params![id, parent, dir, title, updated, viewed],
    )
    .unwrap();
}

fn add_msg(c: &Connection, session: &str, seq: i64, kind: &str, data: Value, updated: i64) {
    c.execute(
        "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?1, ?2, ?3, ?4, ?5, ?5, ?6)",
        params![format!("msg_{seq}"), session, kind, seq, updated, data.to_string()],
    )
    .unwrap();
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

fn tool(id: &str, name: &str, status: &str, input: Value) -> Value {
    let mut state = json!({"status": status, "input": input});
    match status {
        "completed" => state["content"] = json!([{"type":"text","text":"output"}]),
        "error" => state["error"] = json!({"type":"tool.execution","message":"failed"}),
        _ => {}
    }
    json!({"type":"tool","id":id,"name":name,"state":state,"time":{"created":1000}})
}

fn seed(c: &Connection) {
    add_session(c, "ses_1", CWD, Some("Fix tests"), 5000, None, None);
    add_msg(c, "ses_1", 0, "user", json!({"text":"Fix the tests","time":{"created":1000},"files":[{"mime":"image/png","name":"a"}]}), 1000);
    add_msg(c, "ses_1", 1, "system", json!({"text":"The available tools have changed.","time":{"created":1001}}), 1001);
    add_msg(
        c,
        "ses_1",
        2,
        "assistant",
        json!({"agent":"build","content":[
            {"type":"reasoning","text":""},
            {"type":"reasoning","text":"Run them first"},
            tool("call_1", "bash", "completed", json!({"command":"pnpm test"})),
            tool("call_2", "edit", "error", json!({"filePath":"/home/sam/project/a.ts"})),
            {"type":"text","text":"Fixed."}],"time":{"created":1002}}),
        1002,
    );
    add_msg(c, "ses_1", 3, "compaction", json!({"status":"completed","summary":"Earlier work","time":{"created":1003}}), 1003);
    add_msg(c, "ses_1", 4, "assistant", json!({"content":[],"error":{"type":"aborted","message":"Aborted"},"time":{"created":1004}}), 1004);
    add_msg(c, "ses_1", 5, "synthetic", json!({"text":"Continue if you have next steps","time":{"created":1005}}), 1005);
}

#[test]
fn page_maps_rows_to_items() {
    let dir = tempfile::tempdir().unwrap();
    let (db, c) = create(dir.path());
    seed(&c);
    let log = opencode::log_path(&db, "ses_1");
    assert_eq!(Agent::of_log(&log), Agent::OpenCode);
    let page = transcript::thread_get(&log, None, 50).unwrap();
    assert_eq!(
        texts(&page.items),
        ["u:Fix the tests", "t:Run them first", "tool:bash:ok", "tool:edit:err", "a:Fixed.", "s:Conversation compacted. Earlier work", "s:Interrupted"]
    );
    assert!(matches!(&page.items[0], ThreadItem::User { images: Some(1), .. }));
    match &page.items[2] {
        ThreadItem::Tool { id, input_summary, result, .. } => {
            assert_eq!((id.as_str(), input_summary.as_str()), ("call_1", "pnpm test"));
            assert_eq!(result.as_ref().unwrap().text, "output");
        }
        other => panic!("{other:?}"),
    }
    assert_eq!(page.cursor, None);
    assert_eq!(page.end, 6);
}

#[test]
fn pages_go_back_by_seq() {
    let dir = tempfile::tempdir().unwrap();
    let (db, c) = create(dir.path());
    add_session(&c, "ses_2", CWD, None, 1, None, None);
    for seq in 0..10 {
        add_msg(&c, "ses_2", seq, "user", json!({"text": format!("p{seq}"), "time":{"created": seq}}), seq);
    }
    let log = opencode::log_path(&db, "ses_2");
    let last = transcript::thread_get(&log, None, 4).unwrap();
    assert_eq!(texts(&last.items), ["u:p6", "u:p7", "u:p8", "u:p9"]);
    assert_eq!(last.cursor, Some(6));
    let older = transcript::thread_get(&log, last.cursor, 4).unwrap();
    assert_eq!(texts(&older.items), ["u:p2", "u:p3", "u:p4", "u:p5"]);
    let first = transcript::thread_get(&log, older.cursor, 4).unwrap();
    assert_eq!(texts(&first.items), ["u:p0", "u:p1"]);
    assert_eq!(first.cursor, None);
}

#[test]
fn missing_session_is_not_found() {
    let dir = tempfile::tempdir().unwrap();
    let (db, _c) = create(dir.path());
    let e = transcript::thread_get(&opencode::log_path(&db, "ses_none"), None, 10).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::NotFound);
    let e = transcript::thread_get(&opencode::log_path(&dir.path().join("none.db"), "s"), None, 10).unwrap_err();
    assert_eq!(e.kind(), std::io::ErrorKind::NotFound);
}

#[test]
fn follow_sends_new_rows_and_changed_rows() {
    let dir = tempfile::tempdir().unwrap();
    let (db, c) = create(dir.path());
    add_session(&c, "ses_3", CWD, None, 1, None, None);
    add_msg(&c, "ses_3", 0, "user", json!({"text":"go","time":{"created":10}}), 10);
    let running = json!({"content":[tool("call_1", "bash", "running", json!({"command":"make"}))],"time":{"created":20}});
    add_msg(&c, "ses_3", 1, "assistant", running, 20);
    let log = opencode::log_path(&db, "ses_3");
    let page = transcript::thread_get(&log, None, 50).unwrap();
    assert_eq!(texts(&page.items), ["u:go", "tool:bash:open"]);

    let mut f = transcript::Follower::new(&log, page.end).unwrap();
    // The first poll sends the last row again: it can still change while the agent streams.
    let (items, offset) = f.poll().unwrap().unwrap();
    assert_eq!(texts(&items), ["tool:bash:open"]);
    assert_eq!(offset, 2);
    assert!(f.poll().unwrap().is_none());

    // The tool finishes: OpenCode rewrites the row.
    let done = json!({"content":[tool("call_1", "bash", "completed", json!({"command":"make"})), {"type":"text","text":"Built."}],"time":{"created":20}});
    c.execute("UPDATE session_message SET data = ?1, time_updated = 30 WHERE seq = 1", params![done.to_string()]).unwrap();
    let (items, _) = f.poll().unwrap().unwrap();
    assert_eq!(texts(&items), ["tool:bash:ok", "a:Built."]);
    match &items[0] {
        ThreadItem::Tool { id, .. } => assert_eq!(id, "call_1", "the same id replaces the item in the app"),
        other => panic!("{other:?}"),
    }
    add_msg(&c, "ses_3", 2, "user", json!({"text":"thanks","time":{"created":40}}), 40);
    let (items, offset) = f.poll().unwrap().unwrap();
    assert_eq!(texts(&items), ["u:thanks"]);
    assert_eq!(offset, 3);
    assert!(f.poll().unwrap().is_none());
}

#[test]
fn locate_and_recent_sessions() {
    let dir = tempfile::tempdir().unwrap();
    let home = dir.path();
    let (_db, c) = create(home);
    let now = SystemTime::now();
    let ms = |t: SystemTime| t.duration_since(SystemTime::UNIX_EPOCH).unwrap().as_millis() as i64;
    let ago = |s: u64| ms(now - Duration::from_secs(s));
    add_session(&c, "ses_old", CWD, Some("Old work"), ago(7200), None, None);
    // Updated long ago, but the TUI opened it just now.
    add_session(&c, "ses_viewed", CWD, None, ago(5000), Some(ago(10)), None);
    add_session(&c, "ses_child", CWD, Some("child"), ago(1), None, Some("ses_old"));
    add_session(&c, "ses_other", "/home/sam/other", Some("Other"), ago(3), None, None);
    add_msg(&c, "ses_viewed", 0, "user", json!({"text":"Plan the release","time":{"created":1}}), 1);

    let found = transcript::locate(home, Agent::OpenCode, CWD, Some(now - Duration::from_secs(60)), now).unwrap();
    assert_eq!(found.id, "ses_viewed");
    assert!(found.log_path.starts_with(opencode::SCHEME));
    assert!(transcript::locate(home, Agent::OpenCode, CWD, Some(now), now).is_none());

    let list = transcript::recent_sessions(home, "opencode", CWD, 10);
    let got: Vec<(&str, &str)> = list.iter().map(|s| (s.session.as_str(), s.first_prompt.as_str())).collect();
    assert_eq!(got, [("ses_viewed", "Plan the release"), ("ses_old", "Old work")]);
    assert_eq!(transcript::recent_cwds(home, 10), ["/home/sam/other", CWD]);
}
