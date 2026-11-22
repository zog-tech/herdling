//! The check after `agent.prompt` that the Enter submitted the text, as a pure state machine.
//! `core::live` reads the screen, presses the key and feeds the results back.
//!
//! `terminal.send` pastes the text and presses Enter at once. An agent can take a paste in its
//! own time: Claude Code turns a pasted image path into an `[Image #N]` chip, and with a large
//! image the Enter arrives before the paste is done. The Enter then hits an empty input and does
//! nothing, and the text stays in the input box. The core answers such a send with
//! `started: false`.
//!
//! After that answer herdlingd reads the screen. When the input box holds only the text and stays
//! the same for a moment, it presses Enter once more (`terminal.keys`, which waits while a person
//! types) and checks again. A text that is still in the box gives the error `not_submitted`, so
//! the app does not show "Queued".
//!
//! Before a paste, a box that already holds only the same text (a send that was not submitted)
//! gets Enter, not a second paste. So a retry from the app does not type the text twice.
//!
//! Only an input box between two rule lines (`────`), as Claude Code draws it, counts. With no
//! such box, or a text that the box does not show, herdlingd cannot tell, and the send keeps the
//! answer of the core. Every step stays within the input deadline (`core::typing`).

use std::time::Duration;

use serde_json::Value;

use crate::types::RpcError;

/// The pause between two screen reads.
pub const GAP: Duration = Duration::from_millis(250);

/// The time that one Enter and the check after it need. With less time left, no Enter goes in.
pub const ENTER_RESERVE: Duration = Duration::from_millis(1500);

/// The time that one screen read needs. With less time left, the check stops.
pub const READ_RESERVE: Duration = Duration::from_millis(400);

/// What herdlingd looks for in the input box: the text with no white space and no path lines.
#[derive(Debug, Clone, PartialEq)]
pub struct Needle {
    /// The text lines that are not paths, with all white space removed.
    pub text: String,
    /// The path lines (an attached image), with all white space removed. An agent can show them
    /// as they are or as a chip.
    pub paths: Vec<String>,
}

/// True for a line that is only a file path, as the app adds for an attached photo.
fn path_line(line: &str) -> bool {
    let l = line.trim();
    (l.starts_with('/') || l.starts_with("~/")) && !l.chars().any(char::is_whitespace)
}

fn squeeze(s: &str) -> String {
    s.chars().filter(|c| !c.is_whitespace()).collect()
}

/// The needle of a prompt. None when the prompt has no text to look for (only paths).
pub fn needle(text: &str) -> Option<Needle> {
    let (paths, words): (Vec<&str>, Vec<&str>) = text.lines().partition(|l| path_line(l));
    let text = squeeze(&words.join("\n"));
    if text.is_empty() {
        return None;
    }
    Some(Needle { text, paths: paths.iter().map(|p| squeeze(p)).collect() })
}

/// True for a rule line of an input box: mostly `─`, at least 10 of them.
fn rule_line(line: &str) -> bool {
    let t = line.trim();
    let dashes = t.chars().filter(|c| *c == '─' || *c == '━').count();
    let others = t.chars().filter(|c| !c.is_whitespace() && *c != '─' && *c != '━').count();
    dashes >= 10 && dashes >= 2 * others
}

/// Removes every `[Image #N]` chip.
fn without_chips(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find("[Image#") {
        out.push_str(&rest[..i]);
        let tail = &rest[i + "[Image#".len()..];
        let digits = tail.chars().take_while(char::is_ascii_digit).count();
        if digits > 0 && tail[digits..].starts_with(']') {
            rest = &tail[digits + 1..];
        } else {
            out.push_str("[Image#");
            rest = tail;
        }
    }
    out.push_str(rest);
    out
}

/// The text of the input box on `screen`: the lines between the last two rule lines, with no
/// prompt mark (`❯`, `>`, `›`), no image chips and no white space. None when the screen has no
/// such box.
pub fn input_box(screen: &str) -> Option<String> {
    let lines: Vec<&str> = screen.lines().collect();
    let rules: Vec<usize> = lines.iter().enumerate().filter(|(_, l)| rule_line(l)).map(|(i, _)| i).collect();
    let [.., top, bottom] = rules[..] else { return None };
    let inner: Vec<&str> = lines[top + 1..bottom].iter().map(|l| l.trim().trim_matches('│').trim()).collect();
    let mut text = squeeze(&inner.join("\n"));
    if let Some(c) = text.chars().next().filter(|c| matches!(c, '❯' | '>' | '›')) {
        text = text[c.len_utf8()..].to_string();
    }
    Some(without_chips(&text))
}

/// `ansi` (screen text with SGR) as plain text, with each dim character as a space. Escape
/// sequences go; SGR 2 starts dim text, SGR 0 and 22 end it.
pub fn without_dim(ansi: &str) -> String {
    let mut out = String::with_capacity(ansi.len());
    let mut dim = false;
    let mut chars = ansi.chars().peekable();
    while let Some(c) = chars.next() {
        if c != '\x1b' {
            out.push(if dim && !c.is_whitespace() { ' ' } else { c });
            continue;
        }
        match chars.next() {
            Some('[') => {
                let mut params = String::new();
                let mut fin = None;
                for p in chars.by_ref() {
                    if ('\x40'..='\x7e').contains(&p) {
                        fin = Some(p);
                        break;
                    }
                    params.push(p);
                }
                if fin == Some('m') {
                    let mut vs = params.split(';');
                    while let Some(v) = vs.next() {
                        match v {
                            "" | "0" | "22" => dim = false,
                            "2" => dim = true,
                            // An extended color: its arguments are no attributes.
                            "38" | "48" | "58" => match vs.next() {
                                Some("5") => {
                                    vs.next();
                                }
                                Some("2") => {
                                    vs.nth(2);
                                }
                                _ => {}
                            },
                            _ => {}
                        }
                    }
                }
            }
            // OSC: up to BEL or ST.
            Some(']') => {
                while let Some(p) = chars.next() {
                    if p == '\x07' || (p == '\x1b' && chars.next_if_eq(&'\\').is_some()) {
                        break;
                    }
                }
            }
            _ => {}
        }
    }
    out
}

/// True when the box holds the text of `n` (maybe with other text).
pub fn holds(input: &str, n: &Needle) -> bool {
    input.contains(&n.text)
}

/// True when the box holds the text of `n` and nothing else but its paths.
pub fn only(input: &str, n: &Needle) -> bool {
    let Some(i) = input.find(&n.text) else { return false };
    let mut rest = format!("{}{}", &input[..i], &input[i + n.text.len()..]);
    for p in &n.paths {
        if let Some(j) = rest.find(p.as_str()) {
            rest.replace_range(j..j + p.len(), "");
        }
    }
    rest.is_empty()
}

/// The facts of the terminal before the send.
#[derive(Debug, Clone, PartialEq)]
pub struct Check {
    pub needle: Needle,
    /// The turn before the send.
    pub turn: Option<u64>,
    /// The agent worked before the send.
    pub working: bool,
}

fn turn_of(t: &Value) -> Option<u64> {
    t.get("turn").and_then(Value::as_u64)
}

fn working_of(t: &Value) -> bool {
    t.pointer("/status/state").and_then(Value::as_str) == Some("working")
}

#[derive(Debug, Clone, PartialEq)]
pub enum State {
    /// Waiting for the text to show in the box and stay the same. `last`: the box of the last
    /// read.
    Look { last: Option<String> },
    /// Enter was pressed; waiting for the answer of the key call.
    Pressed,
    /// Checking that the box lost the text.
    Verify,
    Done,
}

/// The result of the last effect.
#[derive(Debug, Clone, PartialEq)]
pub enum Input {
    /// A read of the terminal: its turn, whether it works, and the screen text.
    Screen { turn: Option<u64>, working: bool, text: String },
    /// The answer of the Enter.
    Keyed(Result<(), RpcError>),
    /// A read failed.
    Failed,
}

/// How the send ended.
#[derive(Debug, Clone, PartialEq)]
pub enum Outcome {
    /// No sign of a problem, or herdlingd cannot tell: the answer of the core stands.
    Sent,
    /// The second Enter submitted the text.
    Submitted,
    /// The text stays in the box, not sent.
    NotSubmitted,
    /// The text is in the box with other text. No Enter went in.
    Mixed,
    /// The Enter failed (for example, a person types at the computer).
    Failed(RpcError),
}

#[derive(Debug, Clone, PartialEq)]
pub enum Effect {
    Wait(Duration),
    /// Read the terminal record and the screen.
    Read,
    /// Press Enter.
    Enter,
    Finish(Outcome),
}

fn finish(o: Outcome) -> (State, Vec<Effect>) {
    (State::Done, vec![Effect::Finish(o)])
}

/// The check after the `terminal.send` answer `answer`. `before` is the terminal record from
/// before the send. Only a send that did not start a turn of an idle agent needs a check.
pub fn begin(answer: &Value, before: &Value, needle: Option<Needle>) -> (Option<Check>, State, Vec<Effect>) {
    let not_started = answer.get("started").and_then(Value::as_bool) == Some(false);
    let was_working = working_of(before) || answer.get("status").and_then(Value::as_str) == Some("working");
    let late = answer.get("late").and_then(Value::as_bool) == Some(true);
    match needle {
        Some(needle) if not_started && !was_working && !late => {
            let check = Check { needle, turn: turn_of(before), working: false };
            (Some(check), State::Look { last: None }, vec![Effect::Read])
        }
        _ => {
            let (s, e) = finish(Outcome::Sent);
            (None, s, e)
        }
    }
}

/// The check of a box that already holds only the text, before any paste: press Enter.
pub fn begin_leftover(before: &Value, needle: Needle) -> (Check, State, Vec<Effect>) {
    let check = Check { needle, turn: turn_of(before), working: working_of(before) };
    (check, State::Pressed, vec![Effect::Enter])
}

/// True when the read shows that the agent took the text: a new turn, new work, or a box that
/// does not hold only the text any more. (A short text can be a part of a new suggestion.)
fn taken(c: &Check, turn: Option<u64>, working: bool, input: Option<&str>) -> bool {
    let new_turn = matches!((c.turn, turn), (Some(b), Some(a)) if a > b);
    new_turn || (working && !c.working) || input.is_some_and(|b| !only(b, &c.needle))
}

/// The next state and effects after `input` in `state`, with `left` until the input deadline.
pub fn step(state: State, input: Input, c: &Check, left: Duration) -> (State, Vec<Effect>) {
    match (state, input) {
        (State::Look { last }, Input::Screen { turn, working, text }) => {
            let input = input_box(&text);
            let Some(b) = input else { return finish(Outcome::Sent) };
            let new_turn = matches!((c.turn, turn), (Some(x), Some(a)) if a > x);
            if new_turn || working {
                return finish(Outcome::Sent);
            }
            if !holds(&b, &c.needle) {
                // The paste can still be on its way. With no time left, herdlingd cannot tell.
                if left < ENTER_RESERVE + GAP {
                    return finish(Outcome::Sent);
                }
                return (State::Look { last: None }, vec![Effect::Wait(GAP), Effect::Read]);
            }
            if !only(&b, &c.needle) {
                return finish(Outcome::Mixed);
            }
            if last.as_deref() == Some(b.as_str()) && left >= ENTER_RESERVE {
                return (State::Pressed, vec![Effect::Enter]);
            }
            if left < ENTER_RESERVE + GAP {
                return finish(Outcome::NotSubmitted);
            }
            (State::Look { last: Some(b) }, vec![Effect::Wait(GAP), Effect::Read])
        }
        (State::Look { .. }, Input::Failed) => finish(Outcome::Sent),
        (State::Pressed, Input::Keyed(Ok(()))) => (State::Verify, vec![Effect::Wait(GAP), Effect::Read]),
        (State::Pressed, Input::Keyed(Err(e))) => finish(Outcome::Failed(e)),
        (State::Verify, Input::Screen { turn, working, text }) => {
            let input = input_box(&text);
            if taken(c, turn, working, input.as_deref()) || input.is_none() {
                return finish(Outcome::Submitted);
            }
            if left < GAP + READ_RESERVE {
                return finish(Outcome::NotSubmitted);
            }
            (State::Verify, vec![Effect::Wait(GAP), Effect::Read])
        }
        // The Enter went in; a failed read cannot tell more.
        (State::Verify, Input::Failed) => finish(Outcome::Submitted),
        (State::Done, _) => (State::Done, vec![]),
        // An input that the state does not expect: keep the answer of the core.
        (_, _) => finish(Outcome::Sent),
    }
}

/// The error of a prompt that stays in the input box after the second Enter. A send of the same
/// text again presses Enter on it (see [`begin_leftover`]), so the text does not go in twice.
pub fn not_submitted_error() -> RpcError {
    RpcError {
        code: "not_submitted".into(),
        message: "Not sent: the text is in the input of the terminal, but Enter did not submit it. \
                  Send it again to press Enter on it. The text is not typed twice."
            .into(),
    }
}

/// The error of a prompt that is in the input box together with other text. No Enter went in.
pub fn mixed_error() -> RpcError {
    RpcError {
        code: "not_submitted".into(),
        message: "Not sent: the text is in the input of the terminal together with other text. \
                  Look at the terminal before you send it again."
            .into(),
    }
}
