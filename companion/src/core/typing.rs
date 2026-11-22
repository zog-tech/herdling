//! Phone input to a Herdr 2 terminal: the rules, pure. `core::live` does the calls.
//!
//! Two paths:
//! - A line with Enter goes through `terminal.send`. The core pastes it and presses Enter once
//!   nobody types at the computer. herdlingd bounds the call with [`INPUT_TIMEOUT`] and then
//!   closes the connection: the core cancels a send that has not typed yet. See [`late_send`].
//! - Text without Enter, and keys, are typed at once as raw bytes on a short `terminal.attach`
//!   stream ([`type_frame`]). `terminal.keys` has no key for most punctuation, accents or emoji,
//!   and it waits for quiet at the computer with no way to cancel it. A key that [`encode_key`]
//!   cannot encode goes through `terminal.keys`, bounded by the same deadline.
//!
//! Why no queued delivery: the app gives a typing call 15 s. A call that answers later, or a
//! text that goes in after an error, makes the user send again, and then both arrive. So every
//! input call answers within [`INPUT_TIMEOUT`], and a send that times out is cancelled.

use std::time::Duration;

use serde_json::Value;

use super::frame;

/// The longest time of one phone input call, from its arrival to its answer: well within the
/// 15 s that the app gives it.
pub const INPUT_TIMEOUT: Duration = Duration::from_secs(10);

/// The pause between two keys, as the core makes it, so `esc` then `x` is not `alt+x`.
pub const KEY_GAP: Duration = Duration::from_millis(30);

/// The frame kind of the typed bytes. `AUTOMATIC_INPUT` reaches the program as it is, but it
/// does not count as a person at the computer: the core does not hold its own sends for it (no
/// quiet period, no draft), and the attach does not take the size of the terminal. A core that
/// has no `automatic_input` gets DATA: the bytes then count as typing at the computer.
pub fn type_frame(features_automatic: bool, attach_confirms: bool) -> u8 {
    if features_automatic && attach_confirms {
        frame::AUTOMATIC_INPUT
    } else {
        frame::DATA
    }
}

/// The terminal modes that change the bytes of a key.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Modes {
    /// DECCKM: the arrows, Home and End send `ESC O x`.
    pub app_cursor: bool,
}

/// The modes that the first paint of an attach sets. The paint starts the screen of the program,
/// with its modes, so a new emulator fed with it knows them. The size does not change a mode.
pub fn modes_of(paint: &[u8]) -> Modes {
    let n = |v| std::num::NonZeroU16::new(v).expect("not zero");
    let mut p = vt100::Parser::new(n(24), n(80), 0);
    p.process(paint);
    Modes { app_cursor: p.screen().application_cursor() }
}

/// The xterm modifier number: 1 + shift (1) + alt (2) + ctrl (4).
fn modifier(shift: bool, alt: bool, ctrl: bool) -> u8 {
    1 + u8::from(shift) + 2 * u8::from(alt) + 4 * u8::from(ctrl)
}

/// The bytes of one key name (`enter`, `ctrl+c`, `alt+x`, `up`, `f5`, `a`, `shift+tab`), in the
/// xterm legacy encoding for the `modes` of the program. None for a key that has no legacy
/// form (for example `shift+enter`, `super+x`) or a name that is not known: the core then
/// encodes it (`terminal.keys`). Programs that ask for the kitty keyboard read these legacy
/// bytes too.
pub fn encode_key(spec: &str, modes: Modes) -> Option<Vec<u8>> {
    let lower = spec.to_ascii_lowercase();
    let mut parts: Vec<&str> = lower.split('+').collect();
    let name = parts.pop().filter(|n| !n.is_empty())?;
    let (mut shift, mut alt, mut ctrl) = (false, false, false);
    for m in parts {
        match m {
            "shift" => shift = true,
            "alt" | "meta" | "opt" => alt = true,
            "ctrl" | "control" => ctrl = true,
            _ => return None,
        }
    }
    let m = modifier(shift, alt, ctrl);
    let csi_letter = |x: char| -> Vec<u8> {
        if m == 1 {
            if modes.app_cursor { format!("\x1bO{x}") } else { format!("\x1b[{x}") }.into_bytes()
        } else {
            format!("\x1b[1;{m}{x}").into_bytes()
        }
    };
    let tilde = |n: u8| -> Vec<u8> { if m == 1 { format!("\x1b[{n}~") } else { format!("\x1b[{n};{m}~") }.into_bytes() };
    let alt_prefix = |mut b: Vec<u8>| -> Vec<u8> {
        if alt {
            b.insert(0, 0x1b);
        }
        b
    };
    let named = match name {
        "up" => Some(csi_letter('A')),
        "down" => Some(csi_letter('B')),
        "right" => Some(csi_letter('C')),
        "left" => Some(csi_letter('D')),
        "home" => Some(csi_letter('H')),
        "end" => Some(csi_letter('F')),
        "insert" => Some(tilde(2)),
        "delete" | "del" => Some(tilde(3)),
        "pageup" | "pgup" => Some(tilde(5)),
        "pagedown" | "pgdn" => Some(tilde(6)),
        _ => None,
    };
    if named.is_some() {
        return named;
    }
    if let Some(n) = name.strip_prefix('f').and_then(|n| n.parse::<u8>().ok()).filter(|n| (1..=12).contains(n)) {
        return Some(match n {
            1..=4 => {
                let x = (b'P' + n - 1) as char;
                if m == 1 { format!("\x1bO{x}").into_bytes() } else { format!("\x1b[1;{m}{x}").into_bytes() }
            }
            _ => tilde([15, 17, 18, 19, 20, 21, 23, 24][(n - 5) as usize]),
        });
    }
    // The rest has no CSI form: shift and ctrl change the byte, alt adds ESC.
    let base: Vec<u8> = match name {
        "enter" | "return" if !shift && !ctrl => vec![b'\r'],
        "tab" if shift && !ctrl && !alt => return Some(b"\x1b[Z".to_vec()),
        "tab" if !shift && !ctrl => vec![b'\t'],
        "backspace" if !shift && !ctrl => vec![0x7f],
        "esc" | "escape" if !shift && !ctrl => vec![0x1b],
        "space" if ctrl && !shift => vec![0],
        "space" if !shift => vec![b' '],
        _ => {
            let mut chars = name.chars();
            let (c, None) = (chars.next()?, chars.next()) else { return None };
            if !(c.is_ascii_lowercase() || c.is_ascii_digit() || "`[]\\,=-.';/".contains(c)) {
                return None;
            }
            match (shift, ctrl) {
                (false, false) => vec![c as u8],
                (true, false) if c.is_ascii_lowercase() => vec![c.to_ascii_uppercase() as u8],
                (false, true) if c.is_ascii_lowercase() => vec![c as u8 - b'a' + 1],
                (false, true) if c == '[' => vec![0x1b],
                (false, true) if c == '\\' => vec![0x1c],
                (false, true) if c == ']' => vec![0x1d],
                _ => return None,
            }
        }
    };
    Some(alt_prefix(base))
}

/// The bytes of each key, or None when one of them has no legacy form.
pub fn encode_keys(keys: &[String], modes: Modes) -> Option<Vec<Vec<u8>>> {
    keys.iter().map(|k| encode_key(k, modes)).collect()
}

/// After a `terminal.send` timed out and its connection closed: true when the text went in
/// anyway. `before` and `after` are the terminal records from before the send and after the
/// close. The core cancels a send that has not typed yet; a send that typed and then waited
/// for the agent to start shows a new turn or a `working` status.
pub fn late_send(before: &Value, after: &Value) -> bool {
    let turn = |t: &Value| t.get("turn").and_then(Value::as_u64);
    let working = |t: &Value| t.pointer("/status/state").and_then(Value::as_str) == Some("working");
    matches!((turn(before), turn(after)), (Some(b), Some(a)) if a > b) || (working(after) && !working(before))
}

/// The error of an input that never reached the core: an earlier input to the same pane took
/// the time. Nothing was typed, so the user can send it again.
pub fn busy_error() -> crate::types::RpcError {
    crate::types::RpcError {
        code: "busy".into(),
        message: "Not sent: an earlier input to this terminal still waits. Nothing was typed. Send it again.".into(),
    }
}

/// The error of a `terminal.send` that timed out and showed no sign that it went in. The core
/// cancels a send that has not typed yet, so mostly nothing was typed; an agent that got the
/// text and did not start cannot be told apart. The text asks the user to look first.
pub fn unconfirmed_error() -> crate::types::RpcError {
    crate::types::RpcError {
        code: "busy".into(),
        message: "Not confirmed: someone is typing at the computer, so the core held the text and then dropped it. \
                  Look at the terminal before you send it again."
            .into(),
    }
}

/// A terminal younger than this can still run the startup files of its shell. An older one is
/// typed into at once.
pub const FRESH_MS: u64 = 30_000;

/// The longest wait for a new shell to show its prompt before the agent command is typed.
pub const READY_LIMIT: Duration = Duration::from_secs(5);

/// The pause between two checks of a new shell.
pub const READY_GAP: Duration = Duration::from_millis(200);

/// Whether a shell can take a typed command now.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ready {
    /// Type now.
    Yes,
    /// The shell still starts: check again.
    Wait,
    /// The screen is quiet and its last line asks a question (`[Y/n]`, `Password:`). A typed
    /// command would answer it.
    Question,
}

/// Whether the shell in terminal `t` (a `terminal.get` record) can take a typed command. `screen`
/// is its screen text now and `last` the screen of the check before; `now_ms` is the time.
///
/// A new shell runs its startup files first. A startup file can read one key (oh-my-zsh asks
/// "update? [Y/n]"), and that key is then the first letter of the command. So a new shell gets the
/// command only when its screen is quiet and its last line does not look like a question. A
/// terminal older than [`FRESH_MS`] is ready.
pub fn shell_ready(t: &Value, screen: &str, last: Option<&str>, now_ms: u64) -> Ready {
    let created = t.get("created_ms").and_then(Value::as_u64).unwrap_or(0);
    if now_ms.saturating_sub(created) > FRESH_MS {
        return Ready::Yes;
    }
    // A program that a startup file runs holds the foreground.
    let fg = t.pointer("/foreground/pid").and_then(Value::as_u64);
    if fg.is_some() && fg != t.get("pid").and_then(Value::as_u64) {
        return Ready::Wait;
    }
    let Some(line) = screen.lines().map(str::trim).rfind(|l| !l.is_empty()) else { return Ready::Wait };
    if last != Some(screen) {
        return Ready::Wait;
    }
    if line.ends_with(['?', ']', ')', ':']) {
        return Ready::Question;
    }
    Ready::Yes
}

/// The error of an agent command that was not typed: the new shell asks a question.
pub fn shell_question_error() -> crate::types::RpcError {
    crate::types::RpcError {
        code: "shell_not_ready".into(),
        message: "Not started: the shell in the new terminal asks a question, so the agent command was not typed. \
                  Answer it in the terminal, then start the agent again."
            .into(),
    }
}
