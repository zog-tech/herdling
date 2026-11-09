//! Numbered choices of an agent's permission menu on a terminal screen. A port of `parseChoices`
//! in `app/src/thread/choices.ts`: both sides must give the same result, and the tests use the
//! same fixtures (`app/src/thread/__fixtures__`). `serve` uses it to put Yes and No buttons on a
//! "needs you" push, and `pane.answer` uses it to check the menu before it sends a key.

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Only the last non-empty lines of the screen can hold the menu.
const SCAN_LINES: usize = 20;
/// Longest option label in a push. A longer label is cut and ends with "…".
pub const MAX_LABEL: usize = 60;

/// One numbered option of a permission menu.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Choice {
    /// "1" to "9".
    pub key: String,
    pub label: String,
    /// True for the line with the selection marker.
    pub selected: bool,
}

fn is_box(c: char) -> bool {
    c.is_whitespace() || matches!(c, '│' | '╭' | '╮' | '╰' | '╯' | '─')
}

/// `(key, label, selected)` when `text` is a choice line: an optional marker, one digit, a dot,
/// white space and a label. `text` has no box edges and no white space at the two ends.
fn choice_line(text: &str) -> Option<(char, &str, bool)> {
    let mut rest = text.trim_start();
    let mut selected = false;
    if let Some(c) = rest.chars().next().filter(|c| matches!(c, '❯' | '›' | '>')) {
        selected = true;
        rest = rest[c.len_utf8()..].trim_start();
    }
    let mut chars = rest.chars();
    let digit = chars.next().filter(char::is_ascii_digit)?;
    if chars.next() != Some('.') {
        return None;
    }
    let after = chars.as_str();
    if !after.starts_with(char::is_whitespace) {
        return None;
    }
    let label = after.trim();
    (!label.is_empty()).then_some((digit, label, selected))
}

/// Numbered choices of a permission menu on the visible screen, or an empty list.
/// Looks only at the last 20 non-empty lines and takes the last block of consecutive choice lines.
/// A line indented deeper than the digit of the choice above it is a wrapped part of that label.
/// The block counts only when it runs 1..n (n ≥ 2) and exactly one line has the selection marker.
pub fn parse_choices(screen: &str) -> Vec<Choice> {
    find_menu(screen).map(|m| m.choices).unwrap_or_default()
}

/// The menu of a screen: its choices, and the non-empty screen lines (box edges removed) with the
/// range of the menu block in them.
struct Menu<'a> {
    choices: Vec<Choice>,
    lines: Vec<&'a str>,
    block: std::ops::Range<usize>,
}

fn find_menu(screen: &str) -> Option<Menu<'_>> {
    // Box edges are removed, but the indent (box characters count as indent) is kept for wrap detection.
    let all: Vec<(usize, &str)> = screen
        .split('\n')
        .map(|raw| {
            let l = raw.strip_suffix('\r').unwrap_or(raw).trim_end_matches(is_box);
            let text = l.trim_start_matches(is_box);
            (l[..l.len() - text.len()].chars().count(), text)
        })
        .filter(|(_, text)| !text.is_empty())
        .collect();
    let first = all.len().saturating_sub(SCAN_LINES);

    let mut block: Vec<Choice> = vec![];
    let mut range = 0..0;
    let mut current: Vec<Choice> = vec![];
    let mut start = 0;
    let mut digit_col = 0;
    for (i, &(indent, text)) in all.iter().enumerate().skip(first) {
        if let Some((digit, label, selected)) = choice_line(text) {
            if current.is_empty() {
                start = i;
            }
            current.push(Choice { key: digit.to_string(), label: label.to_string(), selected });
            digit_col = indent + text.chars().take_while(|c| *c != digit).count();
        } else if !current.is_empty() && indent > digit_col {
            let last = current.last_mut().expect("current is not empty");
            last.label = format!("{} {text}", last.label);
        } else if !current.is_empty() {
            block = std::mem::take(&mut current);
            range = start..i;
        }
    }
    if !current.is_empty() {
        block = current;
        range = start..all.len();
    }

    if block.len() < 2
        || !block.iter().enumerate().all(|(i, c)| c.key == (i + 1).to_string())
        || block.iter().filter(|c| c.selected).count() != 1
    {
        return None;
    }
    Some(Menu { choices: block, lines: all.into_iter().map(|(_, t)| t).collect(), block: range })
}

/// Non-empty lines above the menu that [`menu_question`] reads: the question and the command.
const QUESTION_LINES: usize = 8;

/// A short digest (16 hex characters) of the question of the menu on the screen: up to
/// `QUESTION_LINES` non-empty lines above the menu and the menu lines. Box edges, the selection
/// marker and runs of white space do not count, so a moved selection or a wider box gives the
/// same digest. `None` when the screen has no menu. A push carries the digest, not the text, and
/// `pane.answer` compares it, so a stale push cannot answer a later prompt with the same labels.
/// A changed screen above the menu can give a false `stale`, which is safe.
pub fn menu_question(screen: &str) -> Option<String> {
    let m = find_menu(screen)?;
    let from = m.block.start.saturating_sub(QUESTION_LINES);
    let mut text = String::new();
    for (i, line) in m.lines[from..m.block.end].iter().enumerate() {
        let line = if from + i >= m.block.start {
            line.trim_start().trim_start_matches(['❯', '›', '>'])
        } else {
            line
        };
        text.push_str(&line.split_whitespace().collect::<Vec<_>>().join(" "));
        text.push('\n');
    }
    let digest = Sha256::digest(text.as_bytes());
    Some(digest.iter().take(8).map(|b| format!("{b:02x}")).collect())
}

/// True when `label` starts with the word `word` ("No" matches "No, and…" but not "None").
fn starts_with_word(label: &str, word: &str) -> bool {
    label.strip_prefix(word).is_some_and(|rest| !rest.starts_with(|c: char| c.is_alphanumeric() || c == '_'))
}

/// `label` cut to [`MAX_LABEL`] characters. A cut label ends with "…".
pub fn short_label(label: &str) -> String {
    if label.chars().count() <= MAX_LABEL {
        return label.to_string();
    }
    let cut: String = label.chars().take(MAX_LABEL - 1).collect();
    format!("{}…", cut.trim_end())
}

/// One option of a push's `data.choice`.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct PushOption {
    pub key: String,
    /// At most [`MAX_LABEL`] characters.
    pub label: String,
}

/// The `data.choice` of a "needs you" push: the first ("Yes…") and the last ("No…") option.
/// It has no question text, because the push passes Expo and Apple or Google.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub struct PushChoice {
    pub yes: PushOption,
    pub no: PushOption,
    /// The herdr `pane.read` revision of the screen.
    pub revision: u64,
    /// [`menu_question`] of the screen. The app sends it back as `expect_question`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub question: Option<String>,
}

/// The Yes and No options of `choices`, when the first label starts with "Yes" and the last
/// label starts with "No". Otherwise `None`, and the push has no buttons.
pub fn yes_no(choices: &[Choice], revision: u64) -> Option<PushChoice> {
    let (first, last) = (choices.first()?, choices.last()?);
    if choices.len() < 2 || !starts_with_word(&first.label, "Yes") || !starts_with_word(&last.label, "No") {
        return None;
    }
    let opt = |c: &Choice| PushOption { key: c.key.clone(), label: short_label(&c.label) };
    Some(PushChoice { yes: opt(first), no: opt(last), revision, question: None })
}

/// True when the option label on screen is `expected`. The app can send the label of a push,
/// which can be cut, so the cut form of the label also matches.
pub fn label_matches(on_screen: &str, expected: &str) -> bool {
    on_screen == expected || short_label(on_screen) == expected
}
