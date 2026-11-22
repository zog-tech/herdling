//! `herdlingd rpc` actions on Herdr 2 entries with a fake core: new tabs and spaces, agent
//! start, prompt, rename, close, explain, the app's restart and resume sequences, and the
//! hello gate. No test reaches a real core.

#[path = "support/fake_core.rs"]
mod fake_core;
use std::time::Duration;

use fake_core::{terminal, FakeCore, State};
use herdlingd::core::endpoint::CoreSocket;
use herdlingd::rpc::{self, Ctx};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

pub struct Session {
    tx: tokio::io::DuplexStream,
    rx: tokio::io::Lines<BufReader<tokio::io::DuplexStream>>,
    next: u64,
}

impl Session {
    pub fn start(ctx: Ctx) -> Session {
        let (client_tx, server_in) = tokio::io::duplex(65536);
        let (server_out, client_rx) = tokio::io::duplex(1 << 20);
        tokio::spawn(rpc::run(BufReader::new(server_in), server_out, ctx));
        Session { tx: client_tx, rx: BufReader::new(client_rx).lines(), next: 1 }
    }
    pub async fn call(&mut self, method: &str, params: Value) -> Value {
        let id = self.next;
        self.next += 1;
        let line = json!({"id": id, "method": method, "params": params}).to_string();
        self.tx.write_all(format!("{line}\n").as_bytes()).await.unwrap();
        loop {
            let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["id"] == id {
                return v;
            }
        }
    }
    pub async fn herdr(&mut self, method: &str, params: Value) -> Value {
        self.call("herdr.call", json!({"method": method, "params": params})).await
    }
    /// The data of the next stream event.
    pub async fn event(&mut self) -> Value {
        loop {
            let line = tokio::time::timeout(Duration::from_secs(10), self.rx.next_line()).await.expect("timed out").unwrap().unwrap();
            let v: Value = serde_json::from_str(&line).unwrap();
            if v["method"] == "event" {
                return v["params"]["data"].clone();
            }
        }
    }
}

pub struct Setup {
    pub dir: tempfile::TempDir,
    pub core: FakeCore,
}

impl Setup {
    pub fn ctx(&self) -> Ctx {
        let mut ctx = Ctx::new(self.dir.path().into());
        ctx.core_socket = Some(CoreSocket::fixed(self.dir.path().join("core.sock")));
        ctx
    }
    /// The labels of terminal `addr` in the fake core now.
    pub fn labels(&self, addr: &str) -> Value {
        let st = self.core.state.lock().unwrap();
        st.terminals.iter().find(|t| t["address"] == addr).map(|t| t["labels"].clone()).unwrap_or(Value::Null)
    }
}

/// The layout document: space s1 with tab a (t1, t2).
pub fn doc() -> Value {
    json!({"spaces": [{"id": "s1", "name": "api", "tabs": [
        {"id": "a", "name": "main", "root": {"type": "row", "children": [
            {"type": "block", "content": {"terminal": "t1"}}, {"type": "block", "content": {"terminal": "t2"}}]}}]}]})
}

/// t1 (an agent, in space s1), t2 (a shell, in s1) and t3 (an agent in no space, label group "Clips").
pub fn setup() -> Setup {
    setup_with(|_| {})
}

pub fn setup_with(f: impl FnOnce(&mut State)) -> Setup {
    let dir = tempfile::tempdir().unwrap();
    let mut t3 = terminal("t3", None, Some("idle"));
    t3["labels"] = json!({"herdling.group": "Clips", "other": "keep"});
    let mut st = State {
        terminals: vec![terminal("t1", None, Some("working")), terminal("t2", None, None), t3],
        doc: doc(),
        screen: "line 1\n\nAllow edit?\n".into(),
        ..State::default()
    };
    f(&mut st);
    let core = fake_core::spawn(&dir.path().join("core.sock"), st);
    Setup { dir, core }
}

fn is_id(v: &Value, prefix: &str) -> bool {
    v.as_str().is_some_and(|s| s.starts_with(prefix) && s.len() == prefix.len() + 32)
}

#[tokio::test]
async fn tab_create_in_a_space_runs_a_labelled_shell() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj", "focus": false})).await;
    let res = &r["result"];
    assert_eq!(res["root_pane"]["pane_id"], "t4", "{r}");
    assert_eq!(res["workspace"]["workspace_id"], "space:s1");
    let runs = s.core.calls_of("terminal.run");
    assert_eq!(runs.len(), 1);
    let run = &runs[0];
    assert_eq!(run["cwd"], "/home/sam/proj");
    assert_eq!(run["keep"], true);
    assert_eq!(run["labels"]["herdr.space"], "s1");
    assert!(is_id(&run["labels"]["herdr.tab"], "tb"), "{run}");
    assert_eq!(run["labels"].as_object().unwrap().len(), 2, "no other label");
    assert_eq!(res["tab"]["tab_id"], format!("tab:{}", run["labels"]["herdr.tab"].as_str().unwrap()));
    // The new terminal shows in the space at once.
    let snap = sess.herdr("session.snapshot", json!({})).await;
    let pane = snap["result"]["snapshot"]["panes"].as_array().unwrap().iter().find(|p| p["pane_id"] == "t4").cloned().unwrap();
    assert_eq!(pane["workspace_id"], "space:s1");
    assert_eq!(pane["tab_id"], res["tab"]["tab_id"]);
}

#[tokio::test]
async fn tab_create_in_a_label_group_keeps_the_label() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("tab.create", json!({"workspace_id": "g:clips", "cwd": "/home/sam/clips"})).await;
    assert_eq!(r["result"]["workspace"]["workspace_id"], "g:clips", "{r}");
    assert_eq!(r["result"]["tab"]["tab_id"], "task:t4");
    assert_eq!(s.core.calls_of("terminal.run")[0]["labels"], json!({"herdling.group": "Clips"}));
    let r = sess.herdr("tab.create", json!({"workspace_id": "g:none", "cwd": "/home/sam"})).await;
    assert_eq!(r["error"]["code"], "workspace_not_found");
    assert_eq!(s.core.calls_of("terminal.run").len(), 1);
}

#[tokio::test]
async fn workspace_create_for_the_core_makes_a_new_space() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("workspace.create", json!({"cwd": "/home/sam/web", "label": "web", "backend": "core"})).await;
    let run = &s.core.calls_of("terminal.run")[0];
    let space = run["labels"]["herdr.space"].as_str().unwrap();
    assert!(is_id(&run["labels"]["herdr.space"], "sp"), "{run}");
    assert!(is_id(&run["labels"]["herdr.tab"], "tb"));
    assert_eq!(r["result"]["workspace"]["workspace_id"], format!("space:{space}"));
    assert_eq!(r["result"]["root_pane"]["pane_id"], "t4");
    // Without the marker (old apps), the core is the default.
    let r = sess.herdr("workspace.create", json!({"cwd": "/home/sam/web", "label": "web", "focus": false})).await;
    assert_eq!(r["result"]["root_pane"]["pane_id"], "t5", "{r}");
    assert_eq!(s.core.calls_of("terminal.run").len(), 2);
    assert!(is_id(&s.core.calls_of("terminal.run")[1]["labels"]["herdr.space"], "sp"));
}

#[tokio::test]
async fn agent_start_types_the_agent_command() {
    // t2 runs zsh: POSIX quotes.
    let s = setup_with(|st| st.terminals[1]["foreground"]["name"] = json!("zsh"));
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.start", json!({"name": "proj-hc-t2", "kind": "claude", "pane_id": "t2", "args": ["--resume", "abc 1"]})).await;
    assert_eq!(r["result"]["agent"]["pane_id"], "t2", "{r}");
    let sends = s.core.calls_of("terminal.send");
    assert_eq!(sends.len(), 1);
    assert_eq!(sends[0]["terminal"], "t2");
    assert_eq!(sends[0]["text"], "claude --resume 'abc 1'");
    assert_eq!(s.labels("t2"), json!({}), "the herdr agent name is not a label");
    let r = sess.herdr("agent.start", json!({"kind": "nope", "pane_id": "t2"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    let r = sess.herdr("agent.start", json!({"kind": "claude", "pane_id": "t99"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");
}

#[tokio::test]
async fn agent_start_quotes_for_the_shell_in_the_pane() {
    // t2 runs fish: a backslash and a quote need the fish escapes, not the POSIX form.
    let s = setup_with(|st| st.terminals[1]["foreground"]["name"] = json!("fish"));
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.start", json!({"kind": "claude", "pane_id": "t2", "args": ["--resume", r"a\'b"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], r"claude --resume 'a\\\'b'");
    // A control character never reaches the shell.
    let r = sess.herdr("agent.start", json!({"kind": "claude", "pane_id": "t2", "args": ["x\nrm -rf ~"]})).await;
    assert_eq!(r["error"]["code"], "bad_request", "{r}");
    assert_eq!(s.core.calls_of("terminal.send").len(), 1);
}

#[tokio::test]
async fn prompt_waits_for_the_agent() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.prompt", json!({"target": "t2", "text": "fix it"})).await;
    assert_eq!(r["error"]["code"], "agent_not_ready", "{r}");
    assert!(r["error"]["message"].as_str().unwrap().contains("not an active named agent"));
    assert!(s.core.calls_of("terminal.send").is_empty(), "no text goes into the shell");
    let r = sess.herdr("agent.prompt", json!({"target": "t1", "text": "fix it"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "fix it");
}

/// The calls of `restartAgent` with a kept conversation (app `herdr/sessionActions.ts`):
/// close the old pane, check the workspace, a new tab, the agent with the resume arguments.
#[tokio::test]
async fn restart_sequence_of_the_app() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("pane.close", json!({"pane_id": "t1"})).await;
    assert!(r.get("error").is_none(), "{r}");
    let r = sess.herdr("workspace.get", json!({"workspace_id": "space:s1"})).await;
    assert_eq!(r["result"]["workspace"]["workspace_id"], "space:s1", "{r}");
    let r = sess.herdr("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj/src", "focus": false})).await;
    let pane = r["result"]["root_pane"]["pane_id"].as_str().unwrap().to_string();
    let r = sess.herdr("agent.start", json!({"name": "src-x", "kind": "claude", "pane_id": pane, "args": ["--resume", "abc"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.kill"), [json!({"terminal": "t1"})]);
    assert_eq!(s.core.calls_of("terminal.run")[0]["labels"]["herdr.space"], "s1");
    assert_eq!(s.core.calls_of("terminal.send")[0], json!({"terminal": "t4", "text": "claude --resume abc"}));
}

/// `resumeInFolder` without a workspace: a new space, then the agent with `--resume`. When the
/// workspace of a restart is gone, `workspace.get` fails and the app takes this path too.
#[tokio::test]
async fn resume_sequence_of_the_app() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("workspace.get", json!({"workspace_id": "g:gone"})).await;
    assert_eq!(r["error"]["code"], "workspace_not_found");
    let r = sess.herdr("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj"})).await;
    let pane = r["result"]["root_pane"]["pane_id"].as_str().unwrap().to_string();
    let r = sess.herdr("agent.start", json!({"kind": "codex", "pane_id": pane, "args": ["resume", "s-9"]})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.send")[0]["text"], "codex resume s-9");
    assert!(s.core.calls_of("terminal.kill").is_empty(), "a resume keeps the old pane");
}

#[tokio::test]
async fn rename_sets_only_herdling_name() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.rename", json!({"target": "t3", "name": "fix-login"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.labels("t3"), json!({"herdling.group": "Clips", "other": "keep", "herdling.name": "fix-login"}));
    let snap = sess.herdr("session.snapshot", json!({})).await;
    let agent = snap["result"]["snapshot"]["agents"].as_array().unwrap().iter().find(|a| a["pane_id"] == "t3").cloned().unwrap();
    assert_eq!(agent["name"], "fix-login");
    sess.herdr("agent.rename", json!({"target": "t3", "name": null})).await;
    assert_eq!(s.labels("t3"), json!({"herdling.group": "Clips", "other": "keep"}));
    sess.herdr("tab.rename", json!({"tab_id": "task:t3", "label": "Clip work"})).await;
    assert_eq!(s.labels("t3")["herdling.name"], "Clip work");
    for (m, p) in [
        ("tab.rename", json!({"tab_id": "tab:a", "label": "x"})),
        ("workspace.rename", json!({"workspace_id": "space:s1", "label": "x"})),
        ("workspace.rename", json!({"workspace_id": "g:clips", "label": "x"})),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
    }
    let labels: Vec<Value> = s.core.calls_of("terminal.label");
    assert_eq!(labels.len(), 3);
    assert!(labels.iter().all(|l| l["labels"].as_object().unwrap().keys().all(|k| k == "herdling.name")));
}

#[tokio::test]
async fn close_tab_and_workspace_kill_their_terminals() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("tab.close", json!({"tab_id": "task:t3"})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.kill"), [json!({"terminal": "t3"})]);
    let r = sess.herdr("workspace.close", json!({"workspace_id": "space:s1", "close_group": true})).await;
    assert!(r.get("error").is_none(), "{r}");
    assert_eq!(s.core.calls_of("terminal.kill"), [json!({"terminal": "t3"}), json!({"terminal": "t1"}), json!({"terminal": "t2"})]);
}

#[tokio::test]
async fn close_with_pane_ids_kills_only_the_shown_panes() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("workspace.close", json!({"workspace_id": "space:s1", "pane_ids": ["t2", "t3"]})).await;
    assert_eq!(r["result"]["closed"], json!(["t2"]), "{r}");
    assert_eq!(s.core.calls_of("terminal.kill"), [json!({"terminal": "t2"})]);
    let r = sess.herdr("workspace.close", json!({"workspace_id": "space:s1", "pane_ids": "t1"})).await;
    assert_eq!(r["error"]["code"], "bad_request", "{r}");
}

#[tokio::test]
async fn an_old_app_cannot_close_a_folder_group() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    // t1 and t2 are in no space here: the folder places them in one group.
    s.core.state.lock().unwrap().doc = json!({"spaces": []});
    let snap = sess.herdr("session.snapshot", json!({})).await;
    let panes = snap["result"]["snapshot"]["panes"].as_array().unwrap().clone();
    let ws = panes.iter().find(|p| p["pane_id"] == "t1").unwrap()["workspace_id"].as_str().unwrap().to_string();
    assert!(ws.starts_with("g:"), "{ws}");
    let r = sess.herdr("workspace.close", json!({"workspace_id": ws})).await;
    assert_eq!(r["error"]["code"], "unsupported", "{r}");
    assert!(s.core.calls_of("terminal.kill").is_empty());
    // The new app sends what it showed.
    let r = sess.herdr("workspace.close", json!({"workspace_id": ws, "pane_ids": ["t1"]})).await;
    assert_eq!(r["result"]["closed"], json!(["t1"]), "{r}");
    // A label group still closes as a whole.
    let r = sess.herdr("workspace.close", json!({"workspace_id": "g:clips"})).await;
    assert_eq!(r["result"]["closed"], json!(["t3"]), "{r}");
}

#[tokio::test]
async fn close_unknown_ids_kill_nothing() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    for (m, p, code) in [
        ("tab.close", json!({"tab_id": "loose:tab"}), "tab_not_found"),
        ("tab.close", json!({"tab_id": "tab:none"}), "tab_not_found"),
        ("workspace.close", json!({"workspace_id": "loose"}), "workspace_not_found"),
        ("workspace.close", json!({"workspace_id": "g:gone"}), "workspace_not_found"),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], code, "{m}: {r}");
    }
    assert!(s.core.calls_of("terminal.kill").is_empty());
}

#[tokio::test]
async fn explain_reads_the_screen() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.explain", json!({"target": "t1"})).await;
    let e = &r["result"]["explain"];
    assert_eq!(r["result"]["type"], "agent_explain", "{r}");
    assert_eq!(e["state"], "working");
    assert_eq!(e["evaluated_rules"][0]["evidence"]["region_preview"], "line 1\nAllow edit?");
    let r = sess.herdr("agent.explain", json!({"target": "t9"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");
}

#[tokio::test]
async fn old_core_without_the_method_is_unsupported() {
    let s = setup_with(|st| st.methods = Some(vec!["hello".into(), "terminal.list".into(), "terminal.get".into(), "doc.get".into()]));
    let mut sess = Session::start(s.ctx());
    for (m, p) in [
        ("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam"})),
        ("agent.rename", json!({"target": "t1", "name": "x"})),
        ("tab.close", json!({"tab_id": "task:t3"})),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], "unsupported", "{m}: {r}");
    }
    assert!(s.core.calls_of("terminal.run").is_empty());
    assert!(s.core.calls_of("terminal.label").is_empty());
    assert!(s.core.calls_of("terminal.kill").is_empty());
}

#[tokio::test]
async fn workspace_list_has_the_core_workspaces() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("workspace.list", json!({})).await;
    assert_eq!(r["result"]["type"], "workspace_list");
    let ids: Vec<&str> = r["result"]["workspaces"].as_array().unwrap().iter().map(|w| w["workspace_id"].as_str().unwrap()).collect();
    assert_eq!(ids, ["space:s1", "g:clips"], "{r}");
}

#[tokio::test]
async fn groups_list_counts_spaces_and_groups() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("groups.list", json!({})).await;
    let g = r["result"]["groups"].as_array().unwrap();
    assert_eq!(g.len(), 2, "{r}");
    assert_eq!(g[0]["workspace_id"], "space:s1");
    assert_eq!(g[0]["space_id"], "s1");
    assert_eq!(g[0]["terminals"], 2);
    assert_eq!(g[0]["agents"], 1);
    assert_eq!(g[1]["source"], "label");
    let mut no_core = Session::start(Ctx::new(s.dir.path().into()));
    assert_eq!(no_core.call("groups.list", json!({})).await["error"]["code"], "herdr_unavailable");
}

#[tokio::test]
async fn pane_move_to_new_space_sets_two_labels() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("pane.move", json!({"pane_id": "t3", "new_space": true})).await;
    let l = s.labels("t3");
    let space = l["herdr.space"].as_str().unwrap().to_string();
    assert!(is_id(&l["herdr.space"], "sp") && is_id(&l["herdr.tab"], "tb"), "{l}");
    assert_eq!(l["herdling.group"], "Clips", "other labels stay");
    assert_eq!(l["other"], "keep");
    assert_eq!(r["result"]["workspace_id"], format!("space:{space}"), "{r}");
    let calls = s.core.calls_of("terminal.label");
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["labels"].as_object().unwrap().len(), 2);
}

#[tokio::test]
async fn pane_move_to_group_sets_one_label() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("pane.move", json!({"pane_id": "t3", "group": "Web"})).await;
    assert_eq!(r["result"]["workspace_id"], "g:web", "{r}");
    assert_eq!(s.core.calls_of("terminal.label")[0]["labels"], json!({"herdling.group": "Web"}));
    sess.call("pane.move", json!({"pane_id": "t3", "group": ""})).await;
    assert_eq!(s.labels("t3"), json!({"other": "keep"}));
}

#[tokio::test]
async fn pane_move_refuses_a_terminal_in_a_space() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("pane.move", json!({"pane_id": "t1", "new_space": true})).await;
    assert_eq!(r["error"]["code"], "unsupported", "{r}");
    let r = sess.call("pane.move", json!({"pane_id": "t9", "group": "x"})).await;
    assert_eq!(r["error"]["code"], "pane_not_found");
    let r = sess.call("pane.move", json!({"pane_id": "t3"})).await;
    assert_eq!(r["error"]["code"], "bad_request");
    assert!(s.core.calls_of("terminal.label").is_empty());
}

#[tokio::test]
async fn session_start_runs_types_and_prompts() {
    let s = setup_with(|st| st.send_starts_agent = true);
    let mut sess = Session::start(s.ctx());
    let r = sess.call("session.start", json!({"cwd": "/home/sam/proj", "kind": "claude", "workspace_id": "space:s1",
                                               "prompt": "fix the login form", "args": ["--model", "opus"]})).await;
    assert_eq!(r["result"]["pane_id"], "t4", "{r}");
    assert_eq!(r["result"]["workspace_id"], "space:s1");
    assert_eq!(r["result"]["prompt_error"], Value::Null);
    let sends: Vec<Value> = s.core.calls_of("terminal.send").into_iter().map(|c| c["text"].clone()).collect();
    let run = &s.core.calls_of("terminal.run")[0];
    // bash, zsh and ksh run the agent line as their command; other shells get it typed.
    let shell = std::env::var("SHELL").ok();
    if herdlingd::core::actions::agent_argv(shell.as_deref(), "claude").is_some() {
        assert_eq!(run["argv"][3], "-c", "{run}");
        assert!(run["argv"][4].as_str().unwrap().starts_with("claude --model opus; exec "), "{run}");
        assert_eq!(sends, [json!("fix the login form")]);
    } else {
        assert_eq!(sends, [json!("claude --model opus"), json!("fix the login form")]);
    }
    assert_eq!(run["labels"]["herdr.space"], "s1");
    // No workspace: a new space.
    let r = sess.call("session.start", json!({"cwd": "/home/sam/web", "kind": "codex"})).await;
    assert!(r["result"]["workspace_id"].as_str().unwrap().starts_with("space:sp"), "{r}");
}

#[tokio::test]
async fn session_start_refusals() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    for (p, code) in [
        (json!({"cwd": "proj", "kind": "claude"}), "bad_request"),
        (json!({"cwd": "/home/sam", "kind": "nope"}), "bad_request"),
        (json!({"cwd": "/home/sam", "kind": "claude", "workspace_id": "g:gone"}), "workspace_not_found"),
    ] {
        let r = sess.call("session.start", p.clone()).await;
        assert_eq!(r["error"]["code"], code, "{p}: {r}");
    }
    assert!(s.core.calls_of("terminal.run").is_empty());
    let mut no_core = Session::start(Ctx::new(s.dir.path().into()));
    let r = no_core.call("session.start", json!({"cwd": "/home/sam", "kind": "claude"})).await;
    assert_eq!(r["error"]["code"], "herdr_unavailable");
}

fn git_ok(dir: &std::path::Path, args: &[&str]) -> bool {
    std::process::Command::new("git").arg("-C").arg(dir).args(args).status().map(|s| s.success()).unwrap_or(false)
}

#[tokio::test]
async fn worktree_for_the_core_opens_a_new_space() {
    let repo = tempfile::tempdir().unwrap();
    let root = repo.path().canonicalize().unwrap();
    let committed = git_ok(&root, &["init", "-b", "main"])
        && git_ok(&root, &["-c", "user.name=sam", "-c", "user.email=sam@example.com", "commit", "--allow-empty", "-m", "x"]);
    if !committed {
        eprintln!("skipped: git is not available");
        return;
    }
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("git.worktree_add", json!({"cwd": root, "branch": "fix-x", "backend": "core"})).await;
    let res = &r["result"];
    let path = root.join(".worktrees/fix-x");
    assert!(path.is_dir(), "{r}");
    assert_eq!(res["via"], "herdr");
    assert_eq!(res["pane_id"], "t4");
    let run = &s.core.calls_of("terminal.run")[0];
    assert_eq!(run["cwd"], path.to_string_lossy().as_ref());
    assert!(is_id(&run["labels"]["herdr.space"], "sp") && is_id(&run["labels"]["herdr.tab"], "tb"), "{run}");
    assert_eq!(res["workspace_id"], format!("space:{}", run["labels"]["herdr.space"].as_str().unwrap()));
    // Without the marker (old apps), the core is the default.
    let r = sess.call("git.worktree_add", json!({"cwd": root, "branch": "fix-y"})).await;
    assert_eq!(r["result"]["via"], "herdr", "{r}");
    assert_eq!(s.core.calls_of("terminal.run").len(), 2);
}

#[tokio::test]
async fn shell_watch_accepts_a_core_pane() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    let r = sess.call("shell.watch", json!({"pane_id": "t2"})).await;
    assert_eq!(r["result"]["pane_id"], "t2", "{r}");
    let r = sess.call("shell.watches", json!({})).await;
    assert_eq!(r["result"]["watches"][0]["pane_id"], "t2");
    let r = sess.call("shell.unwatch", json!({"pane_id": "t2"})).await;
    assert_eq!(r["result"]["removed"], true);
}

/// A new terminal (a login shell from `tab.create` or `session.start`) shows in `pane.watch`
/// through a passive `terminal.attach`, with colors.
#[tokio::test]
async fn new_terminals_show_in_pane_watch() {
    let s = setup_with(|st| {
        st.attach = true;
        st.paint = b"\x18\x1b[H\x1b[2J\x1b[32m~/proj\x1b[0m $".to_vec();
        st.send_starts_agent = true;
    });
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("tab.create", json!({"workspace_id": "space:s1", "cwd": "/home/sam/proj", "focus": false})).await;
    let pane = r["result"]["root_pane"]["pane_id"].as_str().unwrap().to_string();
    let w = sess.call("pane.watch", json!({"pane_id": pane, "lines": 50, "format": "ansi"})).await;
    assert!(w["result"]["stream"].is_string(), "{w}");
    assert_eq!(sess.event().await["text"], "\x1b[0;32m~/proj\x1b[0m $");
    let attach = s.core.calls_of("terminal.attach");
    assert_eq!((attach[0]["terminal"].clone(), attach[0]["observe"].clone()), (json!("t4"), json!(true)));
    // An agent from `session.start` too.
    let r = sess.call("session.start", json!({"cwd": "/home/sam/web", "kind": "claude", "workspace_id": "space:s1"})).await;
    let pane = r["result"]["pane_id"].as_str().unwrap().to_string();
    let w = sess.call("pane.watch", json!({"pane_id": pane, "lines": 50, "format": "ansi"})).await;
    assert!(w["result"]["stream"].is_string(), "{w}");
    assert!(sess.event().await["text"].as_str().unwrap().contains("~/proj"));
    assert_eq!(s.core.calls_of("terminal.attach")[1]["terminal"], "t5");
}

#[tokio::test]
async fn legacy_ids_name_the_same_entries() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    // Saved app state of herdlingd 0.1.x: each id kind with the `hc:` prefix.
    let r = sess.herdr("pane.read", json!({"pane_id": "hc:t1", "source": "visible"})).await;
    assert!(r.get("error").is_none(), "pane: {r}");
    let r = sess.herdr("workspace.get", json!({"workspace_id": "hc:space:s1"})).await;
    assert_eq!(r["result"]["workspace"]["workspace_id"], "space:s1", "space: {r}");
    let r = sess.herdr("workspace.get", json!({"workspace_id": "hc:g:clips"})).await;
    assert_eq!(r["result"]["workspace"]["workspace_id"], "g:clips", "group: {r}");
    let r = sess.herdr("tab.rename", json!({"tab_id": "hc:task:t3", "label": "Clip work"})).await;
    assert!(r.get("error").is_none(), "task tab: {r}");
    assert_eq!(s.labels("t3")["herdling.name"], "Clip work");
    let r = sess.herdr("tab.close", json!({"tab_id": "hc:tab:a"})).await;
    assert!(r.get("error").is_none(), "space tab: {r}");
    assert_eq!(s.core.calls_of("terminal.kill"), [json!({"terminal": "t1"}), json!({"terminal": "t2"})]);
    // Methods outside herdr.call take legacy ids too.
    let r = sess.call("shell.watch", json!({"pane_id": "hc:t3"})).await;
    assert!(r.get("error").is_none(), "shell.watch: {r}");
    let w = sess.call("shell.watches", json!({})).await;
    assert!(w.to_string().contains(r#""t3""#) && !w.to_string().contains("hc:"), "the watch keeps the plain id: {w}");
}

#[tokio::test]
async fn loose_ids_are_not_found() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    for (m, p, code) in [
        ("pane.read", json!({"pane_id": "hc:loose"}), "pane_not_found"),
        ("agent.prompt", json!({"target": "hc:loose", "text": "hi"}), "pane_not_found"),
        ("tab.close", json!({"tab_id": "hc:loose"}), "tab_not_found"),
        ("tab.rename", json!({"tab_id": "hc:loose", "label": "x"}), "tab_not_found"),
        ("workspace.close", json!({"workspace_id": "hc:loose"}), "workspace_not_found"),
        ("workspace.get", json!({"workspace_id": "hc:loose"}), "workspace_not_found"),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], code, "{m}: {r}");
    }
    assert!(s.core.calls_of("terminal.kill").is_empty());
    assert!(s.core.calls_of("terminal.label").is_empty());
}

#[tokio::test]
async fn space_id_with_a_colon_is_not_found() {
    let s = setup();
    let mut sess = Session::start(s.ctx());
    for (m, p, code) in [
        ("tab.create", json!({"workspace_id": "space:s1:x", "cwd": "/home/sam"}), "workspace_not_found"),
        ("workspace.close", json!({"workspace_id": "space:s1:x"}), "workspace_not_found"),
        ("tab.close", json!({"tab_id": "tab:a:x"}), "tab_not_found"),
        ("pane.read", json!({"pane_id": "w1:p1"}), "pane_not_found"),
    ] {
        let r = sess.herdr(m, p).await;
        assert_eq!(r["error"]["code"], code, "{m}: {r}");
    }
    assert!(s.core.calls_of("terminal.run").is_empty());
}

const RULE: &str = "────────────────────────────────────────";

/// A Claude Code screen whose input box holds `input`.
fn box_screen(input: &str) -> String {
    format!("⏺ done\n\n{RULE}\n❯ {input}\n{RULE}\n  status line")
}

#[tokio::test]
async fn a_prompt_that_stays_in_the_input_is_not_submitted() {
    let s = setup_with(|st| {
        st.screen = box_screen("[Image #2]look at this");
        st.send_answer = Some(json!({"started": false, "status": "idle", "turn": 3}));
    });
    let mut ctx = s.ctx();
    ctx.input_timeout = Duration::from_secs(3);
    let mut sess = Session::start(ctx);
    let r = sess.herdr("agent.prompt", json!({"target": "t3", "text": "look at this\n/home/sam/.cache/herdling/uploads/a.png"})).await;
    assert_eq!(r["error"]["code"], "not_submitted", "{r}");
    assert_eq!(s.core.calls_of("terminal.send").len(), 1);
    // One more Enter went in, through the key path of the core.
    let keys: Vec<Value> = s.core.calls_of("terminal.keys").into_iter().map(|c| c["keys"].clone()).collect();
    assert_eq!(keys, [json!(["enter"])]);
}

#[tokio::test]
async fn a_prompt_that_starts_a_turn_is_not_checked() {
    let s = setup_with(|st| {
        st.screen = box_screen("look at this");
        st.send_answer = Some(json!({"started": true, "status": "idle", "turn": 3}));
    });
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.prompt", json!({"target": "t3", "text": "look at this"})).await;
    assert_eq!(r["result"]["started"], true, "{r}");
    assert!(s.core.calls_of("terminal.keys").is_empty());
}

#[tokio::test]
async fn a_resend_of_a_text_in_the_input_presses_enter_only() {
    let s = setup_with(|st| {
        st.screen = box_screen("look at this");
        st.attach = true;
        st.paint = box_screen("look at this").replace('\n', "\r\n").into_bytes();
    });
    let mut ctx = s.ctx();
    ctx.input_timeout = Duration::from_secs(2);
    let mut sess = Session::start(ctx);
    let r = sess.herdr("agent.prompt", json!({"target": "t3", "text": "look at this"})).await;
    // The fake screen does not change, so the text stays; but nothing is typed twice.
    assert_eq!(r["error"]["code"], "not_submitted", "{r}");
    assert!(s.core.calls_of("terminal.send").is_empty());
    assert_eq!(s.core.calls_of("terminal.keys").len(), 1);
}

#[tokio::test]
async fn a_dim_suggestion_in_the_input_is_no_leftover() {
    let s = setup_with(|st| {
        st.screen = box_screen("look at this");
        st.attach = true;
        st.paint = format!("{RULE}\r\n❯ \x1b[2mlook at this\x1b[0m\r\n{RULE}").into_bytes();
    });
    let mut sess = Session::start(s.ctx());
    let r = sess.herdr("agent.prompt", json!({"target": "t3", "text": "look at this"})).await;
    assert!(r["result"].is_object(), "{r}");
    assert_eq!(s.core.calls_of("terminal.send").len(), 1);
    assert!(s.core.calls_of("terminal.keys").is_empty());
}
