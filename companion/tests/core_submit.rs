//! The check after `agent.prompt` that the Enter submitted the text (`core::submit`): the screen
//! rules and each state of the machine.

use std::time::Duration;

use herdlingd::core::submit::{
    begin, begin_leftover, holds, input_box, needle, not_submitted_error, only, step, without_dim, Check, Effect, Input, Needle, Outcome,
    State, GAP,
};
use herdlingd::types::RpcError;
use serde_json::json;

const RULE: &str = "────────────────────────────────────────────────────────────";

/// A Claude Code screen: history, then the input box with `input` on its prompt line.
fn screen(input: &str) -> String {
    format!(
        "❯ [Image #1]Reply with only the word fifth\n  ⎿ \u{a0}[Image #1]\n\n⏺ fifth\n\n{RULE}\n❯\u{a0}{input}\n{RULE}\n  Haiku · apps\n  ⏵⏵ auto mode on"
    )
}

const TEXT: &str = "Reply with only the word sixth\n/home/sam/.cache/herdling/uploads/a1.png";

fn n() -> Needle {
    needle(TEXT).unwrap()
}

fn check() -> Check {
    Check { needle: n(), turn: Some(4), working: false }
}

fn read(input: &str) -> Input {
    Input::Screen { turn: Some(4), working: false, text: screen(input) }
}

const LOTS: Duration = Duration::from_secs(5);

fn done(o: Outcome) -> (State, Vec<Effect>) {
    (State::Done, vec![Effect::Finish(o)])
}

#[test]
fn the_needle_leaves_out_paths_and_white_space() {
    assert_eq!(n(), Needle { text: "Replywithonlythewordsixth".into(), paths: vec!["/home/sam/.cache/herdling/uploads/a1.png".into()] });
    assert_eq!(needle("/home/sam/a.png\n~/b.png"), None);
    assert_eq!(needle("  \n"), None);
    // A line with a path and words is text.
    assert_eq!(needle("look at /home/sam/a.png").unwrap().text, "lookat/home/sam/a.png");
}

#[test]
fn the_box_is_between_the_last_two_rules() {
    assert_eq!(input_box(&screen("[Image #2]Reply with only the word sixth")).as_deref(), Some("Replywithonlythewordsixth"));
    assert_eq!(input_box(&screen("")).as_deref(), Some(""));
    // A long input wraps onto more lines.
    let wrapped = format!("{RULE}\n❯ Reply with only the\n  word sixth\n{RULE}\nstatus");
    assert_eq!(input_box(&wrapped).as_deref(), Some("Replywithonlythewordsixth"));
    // The old box style with side bars.
    let boxed = format!("╭{RULE}╮\n│ > Reply with only the word sixth │\n╰{RULE}╯");
    assert_eq!(input_box(&boxed).as_deref(), Some("Replywithonlythewordsixth"));
    // No box: herdlingd cannot tell.
    assert_eq!(input_box("$ ls\nfile\n$ "), None);
    assert_eq!(input_box(&format!("one rule only\n{RULE}\n> x")), None);
    // A text like a chip that is not one stays.
    assert_eq!(input_box(&screen("[Image #x] hi")).as_deref(), Some("[Image#x]hi"));
}

#[test]
fn holds_and_only() {
    let b = input_box(&screen("[Image #3]Reply with only the word sixth")).unwrap();
    assert!(holds(&b, &n()) && only(&b, &n()));
    // An agent that shows the path as text.
    let b = input_box(&screen("Reply with only the word sixth /home/sam/.cache/herdling/uploads/a1.png")).unwrap();
    assert!(only(&b, &n()));
    // A draft of a person next to the text.
    let b = input_box(&screen("fix the tests Reply with only the word sixth")).unwrap();
    assert!(holds(&b, &n()) && !only(&b, &n()));
    let b = input_box(&screen("")).unwrap();
    assert!(!holds(&b, &n()) && !only(&b, &n()));
}

#[test]
fn dim_text_is_no_input() {
    // Claude Code shows a suggestion for the next prompt in dim text.
    let suggestion = format!("{RULE}\n❯\u{a0}\x1b[0;2mReply with only the word sixth\x1b[0m\n{RULE}");
    assert_eq!(input_box(&without_dim(&suggestion)).as_deref(), Some(""));
    let typed = format!(
        "\x1b[0;38;2;136;136;136m{RULE}\x1b[0m\n\x1b[0;38;2;153;153;153;48;2;55;55;55m❯ \x1b[0;38;2;255;255;255m[Image #2]Reply with only the word sixth\x1b[0m\n{RULE}"
    );
    assert_eq!(input_box(&without_dim(&typed)).as_deref(), Some("Replywithonlythewordsixth"));
    // SGR 22 ends dim text; an OSC goes.
    assert_eq!(without_dim("\x1b[2mab\x1b[22mcd\x1b]0;title\x07e"), "  cde");
}

#[test]
fn only_a_send_that_did_not_start_an_idle_agent_is_checked() {
    let idle = json!({ "turn": 4, "status": { "state": "done" } });
    let working = json!({ "turn": 4, "status": { "state": "working" } });
    let sent = (None, State::Done, vec![Effect::Finish(Outcome::Sent)]);
    assert_eq!(begin(&json!({ "started": true, "turn": 4 }), &idle, Some(n())), sent);
    assert_eq!(begin(&json!({ "started": null, "turn": 4 }), &idle, Some(n())), sent);
    assert_eq!(begin(&json!({ "started": false, "turn": 4 }), &working, Some(n())), sent);
    assert_eq!(begin(&json!({ "started": false, "status": "working", "turn": 4 }), &idle, Some(n())), sent);
    assert_eq!(begin(&json!({ "turn": 5, "late": true }), &idle, Some(n())), sent);
    assert_eq!(begin(&json!({ "started": false, "turn": 4 }), &idle, None), sent);
    assert_eq!(
        begin(&json!({ "started": false, "status": "done", "turn": 4 }), &idle, Some(n())),
        (Some(check()), State::Look { last: None }, vec![Effect::Read])
    );
}

#[test]
fn a_stable_box_with_the_text_gets_enter() {
    let c = check();
    let (s, e) = step(State::Look { last: None }, read("[Image #2]Reply with only the word sixth"), &c, LOTS);
    assert_eq!(e, vec![Effect::Wait(GAP), Effect::Read]);
    assert_eq!(step(s, read("[Image #2]Reply with only the word sixth"), &c, LOTS), (State::Pressed, vec![Effect::Enter]));
}

#[test]
fn a_box_that_changes_waits() {
    let c = check();
    let last = Some("Replywithonlythewordsixth/home/sam/.cache/herdling/uploads/a1.png".to_string());
    let (s, e) = step(State::Look { last }, read("[Image #2]Reply with only the word sixth"), &c, LOTS);
    assert_eq!(s, State::Look { last: Some("Replywithonlythewordsixth".into()) });
    assert_eq!(e, vec![Effect::Wait(GAP), Effect::Read]);
}

#[test]
fn an_empty_box_waits_for_the_paste_then_gives_up() {
    let c = check();
    assert_eq!(step(State::Look { last: None }, read(""), &c, LOTS), (State::Look { last: None }, vec![Effect::Wait(GAP), Effect::Read]));
    assert_eq!(step(State::Look { last: None }, read(""), &c, Duration::from_millis(500)), done(Outcome::Sent));
}

#[test]
fn signs_of_work_or_no_box_keep_the_answer() {
    let c = check();
    let busy = Input::Screen { turn: Some(4), working: true, text: screen("Reply with only the word sixth") };
    assert_eq!(step(State::Look { last: None }, busy, &c, LOTS), done(Outcome::Sent));
    let next = Input::Screen { turn: Some(5), working: false, text: screen("Reply with only the word sixth") };
    assert_eq!(step(State::Look { last: None }, next, &c, LOTS), done(Outcome::Sent));
    let plain = Input::Screen { turn: Some(4), working: false, text: "$ Reply with only the word sixth".into() };
    assert_eq!(step(State::Look { last: None }, plain, &c, LOTS), done(Outcome::Sent));
    assert_eq!(step(State::Look { last: None }, Input::Failed, &c, LOTS), done(Outcome::Sent));
}

#[test]
fn a_draft_of_a_person_gets_no_enter() {
    let c = check();
    assert_eq!(step(State::Look { last: None }, read("fix it Reply with only the word sixth"), &c, LOTS), done(Outcome::Mixed));
}

#[test]
fn no_time_for_enter_is_not_submitted() {
    let c = check();
    let last = Some("Replywithonlythewordsixth".to_string());
    assert_eq!(
        step(State::Look { last }, read("Reply with only the word sixth"), &c, Duration::from_millis(900)),
        done(Outcome::NotSubmitted)
    );
}

#[test]
fn after_enter_the_box_must_lose_the_text() {
    let c = check();
    assert_eq!(step(State::Pressed, Input::Keyed(Ok(())), &c, LOTS), (State::Verify, vec![Effect::Wait(GAP), Effect::Read]));
    let busy = RpcError { code: "busy".into(), message: "someone types".into() };
    assert_eq!(step(State::Pressed, Input::Keyed(Err(busy.clone())), &c, LOTS), done(Outcome::Failed(busy)));
    assert_eq!(step(State::Verify, read(""), &c, LOTS), done(Outcome::Submitted));
    let working = Input::Screen { turn: Some(4), working: true, text: screen("Reply with only the word sixth") };
    assert_eq!(step(State::Verify, working, &c, LOTS), done(Outcome::Submitted));
    assert_eq!(step(State::Verify, read("Reply with only the word sixth"), &c, LOTS), (State::Verify, vec![Effect::Wait(GAP), Effect::Read]));
    assert_eq!(step(State::Verify, read("Reply with only the word sixth"), &c, Duration::from_millis(300)), done(Outcome::NotSubmitted));
    assert_eq!(step(State::Verify, Input::Failed, &c, LOTS), done(Outcome::Submitted));
}

#[test]
fn a_leftover_gets_enter_at_once() {
    let before = json!({ "turn": 4, "status": { "state": "working" } });
    let (c, s, e) = begin_leftover(&before, n());
    assert_eq!((c.turn, c.working), (Some(4), true));
    assert_eq!((s, e), (State::Pressed, vec![Effect::Enter]));
}

#[test]
fn unexpected_inputs_keep_the_answer() {
    let c = check();
    assert_eq!(step(State::Look { last: None }, Input::Keyed(Ok(())), &c, LOTS), done(Outcome::Sent));
    assert_eq!(step(State::Pressed, read(""), &c, LOTS), done(Outcome::Sent));
    assert_eq!(step(State::Done, read(""), &c, LOTS), (State::Done, vec![]));
}

#[test]
fn the_error_has_its_own_code() {
    let e = not_submitted_error();
    assert_eq!(e.code, "not_submitted");
    assert!(e.message.contains("not typed twice"));
}
