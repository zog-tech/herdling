//! The pure state machine of `session.start` on the core: each state, each input and the
//! inputs that a state does not expect.

use std::time::Duration;

use herdlingd::core::start::{begin, step, Effect, Input, Outcome, Plan, State};
use serde_json::json;

fn plan(prompt: Option<&str>) -> Plan {
    Plan { line: "claude".into(), prompt: prompt.map(String::from), max_tries: 3, wait: Duration::from_millis(5) }
}

fn waiting(tries: u32) -> State {
    State::Waiting { addr: "t4".into(), tries }
}

fn started(prompt_error: Option<&str>) -> Effect {
    Effect::Finish(Outcome::Started { addr: "t4".into(), prompt_error: prompt_error.map(String::from) })
}

#[test]
fn begin_runs_the_shell() {
    assert_eq!(begin(), (State::Shell, vec![Effect::Run]));
}

#[test]
fn shell_then_command() {
    let p = plan(None);
    assert_eq!(
        step(State::Shell, Input::Ran("t4".into()), &p),
        (State::Command { addr: "t4".into() }, vec![Effect::Type { addr: "t4".into(), line: "claude".into() }])
    );
    assert_eq!(step(State::Shell, Input::Failed("spawn_failed".into()), &p), (State::Done, vec![Effect::Finish(Outcome::Failed("spawn_failed".into()))]));
}

#[test]
fn command_without_prompt_is_done() {
    assert_eq!(step(State::Command { addr: "t4".into() }, Input::Typed, &plan(None)), (State::Done, vec![started(None)]));
}

#[test]
fn failed_command_kills_the_new_shell() {
    let (s, e) = step(State::Command { addr: "t4".into() }, Input::Failed("timed out".into()), &plan(None));
    assert_eq!(s, State::Done);
    assert_eq!(e, vec![Effect::Kill("t4".into()), Effect::Finish(Outcome::Failed("timed out".into()))]);
}

#[test]
fn command_with_prompt_waits_for_the_agent() {
    let p = plan(Some("fix it"));
    assert_eq!(step(State::Command { addr: "t4".into() }, Input::Typed, &p), (waiting(1), vec![Effect::Get("t4".into())]));
    let shell = json!({"address": "t4", "status": null});
    assert_eq!(step(waiting(1), Input::Record(shell.clone()), &p), (waiting(2), vec![Effect::Wait(p.wait), Effect::Get("t4".into())]));
    let (s, e) = step(waiting(3), Input::Record(shell), &p);
    assert_eq!(s, State::Done);
    assert!(matches!(&e[..], [Effect::Finish(Outcome::Started { prompt_error: Some(_), .. })]), "{e:?}");
    let agent = json!({"address": "t4", "status": {"state": "idle"}});
    assert_eq!(
        step(waiting(2), Input::Record(agent), &p),
        (State::Prompt { addr: "t4".into() }, vec![Effect::Send { addr: "t4".into(), text: "fix it".into() }])
    );
}

#[test]
fn prompt_results() {
    let p = plan(Some("fix it"));
    assert_eq!(step(State::Prompt { addr: "t4".into() }, Input::Sent, &p), (State::Done, vec![started(None)]));
    assert_eq!(step(State::Prompt { addr: "t4".into() }, Input::Failed("blocked".into()), &p), (State::Done, vec![started(Some("blocked"))]));
    assert_eq!(step(waiting(1), Input::Failed("gone".into()), &p), (State::Done, vec![started(Some("gone"))]));
}

#[test]
fn unexpected_inputs_stop() {
    let p = plan(None);
    assert_eq!(step(State::Done, Input::Sent, &p), (State::Done, vec![]));
    let (s, e) = step(State::Shell, Input::Typed, &p);
    assert_eq!(s, State::Done);
    assert!(matches!(&e[..], [Effect::Finish(Outcome::Failed(_))]));
    let (_, e) = step(State::Command { addr: "t4".into() }, Input::Sent, &p);
    assert!(matches!(&e[..], [Effect::Kill(_), Effect::Finish(Outcome::Failed(_))]), "{e:?}");
    let (_, e) = step(waiting(1), Input::Ran("t5".into()), &p);
    assert!(matches!(&e[..], [Effect::Finish(Outcome::Started { prompt_error: Some(_), .. })]), "{e:?}");
}
