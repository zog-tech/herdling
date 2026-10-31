//! Numbered choices of an agent's permission menu on a terminal screen. A port of `parseChoices`
//! in `app/src/thread/choices.ts`: both sides must give the same result, and the tests use the
//! same fixtures (`app/src/thread/__fixtures__`). `serve` uses it to put Yes and No buttons on a
//! "needs you" push, and `pane.answer` uses it to check the menu before it sends a key.

use serde::Serialize;

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
    // Box edges are removed, but the indent (box characters count as indent) is kept for wrap detection.
    let lines: Vec<(usize, &str)> = screen
        .split('\n')
        .map(|raw| {
            let l = raw.strip_suffix('\r').unwrap_or(raw).trim_end_matches(is_box);
            let text = l.trim_start_matches(is_box);
            (l[..l.len() - text.len()].chars().count(), text)
        })
        .filter(|(_, text)| !text.is_empty())
        .collect();
    let lines = &lines[lines.len().saturating_sub(SCAN_LINES)..];

    let mut block: Vec<Choice> = vec![];
    let mut current: Vec<Choice> = vec![];
    let mut digit_col = 0;
    for &(indent, text) in lines {
        if let Some((digit, label, selected)) = choice_line(text) {
            current.push(Choice { key: digit.to_string(), label: label.to_string(), selected });
            digit_col = indent + text.chars().take_while(|c| *c != digit).count();
        } else if !current.is_empty() && indent > digit_col {
            let last = current.last_mut().expect("current is not empty");
            last.label = format!("{} {text}", last.label);
        } else if !current.is_empty() {
            block = std::mem::take(&mut current);
        }
    }
    if !current.is_empty() {
        block = current;
    }

    if block.len() < 2
        || !block.iter().enumerate().all(|(i, c)| c.key == (i + 1).to_string())
        || block.iter().filter(|c| c.selected).count() != 1
    {
        return vec![];
    }
    block
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
}

/// The Yes and No options of `choices`, when the first label starts with "Yes" and the last
/// label starts with "No". Otherwise `None`, and the push has no buttons.
pub fn yes_no(choices: &[Choice], revision: u64) -> Option<PushChoice> {
    let (first, last) = (choices.first()?, choices.last()?);
    if choices.len() < 2 || !starts_with_word(&first.label, "Yes") || !starts_with_word(&last.label, "No") {
        return None;
    }
    let opt = |c: &Choice| PushOption { key: c.key.clone(), label: short_label(&c.label) };
    Some(PushChoice { yes: opt(first), no: opt(last), revision })
}

/// True when the option label on screen is `expected`. The app can send the label of a push,
/// which can be cut, so the cut form of the label also matches.
pub fn label_matches(on_screen: &str, expected: &str) -> bool {
    on_screen == expected || short_label(on_screen) == expected
}
