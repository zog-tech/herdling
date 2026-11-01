//! `choices.rs`: the same cases as `app/src/thread/choices.test.ts`, on the same fixture files,
//! so the app and herdlingd find the same menu.

use herdlingd::choices::{label_matches, parse_choices, short_label, yes_no, Choice, PushChoice, PushOption};

/// A fixture of the app's test, read from `app/src/thread/__fixtures__` (one copy for both sides).
fn fixture(name: &str) -> String {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../app/src/thread/__fixtures__").join(format!("{name}.txt"));
    std::fs::read_to_string(&path).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

fn c(key: &str, label: &str, selected: bool) -> Choice {
    Choice { key: key.into(), label: label.into(), selected }
}

fn labels(v: &[Choice]) -> Vec<&str> {
    v.iter().map(|c| c.label.as_str()).collect()
}

fn bash_choices() -> Vec<Choice> {
    vec![
        c("1", "Yes", true),
        c("2", "Yes, and don't ask again for git status commands in /home/sam/proj", false),
        c("3", "No, and tell Claude what to do differently (esc)", false),
    ]
}

#[test]
fn bash_permission() {
    assert_eq!(parse_choices(&fixture("claude_bash_permission")), bash_choices());
}

#[test]
fn wrapped_labels_are_joined() {
    assert_eq!(parse_choices(&fixture("claude_bash_permission_wrapped")), bash_choices());
}

#[test]
fn a_wrapped_boxed_label_is_joined() {
    let screen = ["│ ❯ 1. Yes                 │", "│   2. No, and tell Claude │", "│      what to do (esc)    │", "╰──────────────────────────╯"].join("\n");
    assert_eq!(parse_choices(&screen)[1].label, "No, and tell Claude what to do (esc)");
}

#[test]
fn text_at_the_choice_indent_ends_the_block() {
    assert_eq!(parse_choices("❯ 1. Yes\n  2. No\n  Esc to cancel").len(), 2);
    assert_eq!(parse_choices("  1. a\n  2. b\n  later text\n❯"), vec![]);
}

#[test]
fn edit_permission() {
    let v = parse_choices(&fixture("claude_edit_permission"));
    assert_eq!(v.iter().map(|c| c.key.as_str()).collect::<Vec<_>>(), ["1", "2", "3"]);
    assert_eq!(v[1], c("2", "Yes, allow all edits during this session (shift+tab)", false));
}

#[test]
fn numbered_prose_is_ignored() {
    assert_eq!(parse_choices(&fixture("claude_numbered_prose")), vec![]);
}

#[test]
fn ask_user_question_labels_are_joined() {
    // The app splits these labels for display only; the labels stay the same on both sides.
    let v = parse_choices(&fixture("claude_ask_user_question"));
    assert_eq!(
        labels(&v),
        [
            "Run tests in parallel (Recommended) Jest runs the test files on four workers, so the run takes about a quarter of the time. I change the config and run the suite again.",
            "Keep config, skip slow tests Make no config change. I mark the three slowest tests as skipped, so the run is faster, but those tests do not run.",
            "Mock the network Replace the real network calls with a mock server. This needs a new test helper.",
            "Type something.",
            "Chat about this",
        ]
    );
    assert!(v[0].selected);
}

#[test]
fn idle_prompt() {
    assert_eq!(parse_choices(&fixture("claude_idle_prompt")), vec![]);
}

#[test]
fn boxed_lines_are_stripped() {
    let screen = ["╭────────────╮", "│ Proceed?   │", "│ ❯ 1. Yes   │", "│   2. No    │", "╰────────────╯"].join("\n");
    assert_eq!(parse_choices(&screen), vec![c("1", "Yes", true), c("2", "No", false)]);
}

#[test]
fn accepts_the_other_markers() {
    assert_eq!(parse_choices("› 1. Allow\n  2. Deny")[0], c("1", "Allow", true));
    assert_eq!(parse_choices("  1. Allow\n> 2. Deny")[1], c("2", "Deny", true));
}

#[test]
fn rejects_a_single_choice() {
    assert_eq!(parse_choices("❯ 1. Yes"), vec![]);
}

#[test]
fn rejects_numbers_that_do_not_run_from_1() {
    assert_eq!(parse_choices("❯ 2. Yes\n  3. No"), vec![]);
    assert_eq!(parse_choices("❯ 1. Yes\n  3. No"), vec![]);
}

#[test]
fn rejects_zero_or_two_markers() {
    assert_eq!(parse_choices("❯ 1. Yes\n❯ 2. No"), vec![]);
    assert_eq!(parse_choices("  1. Yes\n  2. No"), vec![]);
}

#[test]
fn uses_only_the_last_block() {
    let screen = "❯ 1. Old\n  2. Older\nsome text\n  1. Yes\n❯ 2. No";
    assert_eq!(labels(&parse_choices(screen)), ["Yes", "No"]);
}

#[test]
fn ignores_a_menu_above_the_last_20_non_empty_lines() {
    let filler = (0..20).map(|i| format!("line {i}")).collect::<Vec<_>>().join("\n");
    assert_eq!(parse_choices(&format!("❯ 1. Yes\n  2. No\n{filler}")), vec![]);
}

#[test]
fn handles_crlf_line_ends() {
    assert_eq!(parse_choices("❯ 1. Yes\r\n  2. No\r\n").len(), 2);
}

#[test]
fn needs_white_space_after_the_dot() {
    assert_eq!(parse_choices("❯ 1.Yes\n  2.No"), vec![]);
}

#[test]
fn yes_no_takes_the_first_and_the_last_option() {
    let got = yes_no(&parse_choices(&fixture("claude_bash_permission")), 7).unwrap();
    assert_eq!(
        got,
        PushChoice {
            yes: PushOption { key: "1".into(), label: "Yes".into() },
            no: PushOption { key: "3".into(), label: "No, and tell Claude what to do differently (esc)".into() },
            revision: 7,
        }
    );
    // The JSON shape of `data.choice`.
    assert_eq!(
        serde_json::to_value(&got).unwrap(),
        serde_json::json!({"yes": {"key": "1", "label": "Yes"},
                           "no": {"key": "3", "label": "No, and tell Claude what to do differently (esc)"},
                           "revision": 7})
    );
}

#[test]
fn yes_no_needs_yes_first_and_no_last() {
    assert_eq!(yes_no(&[c("1", "Allow", true), c("2", "Deny", false)], 0), None);
    assert_eq!(yes_no(&[c("1", "Yes", true), c("2", "Maybe", false)], 0), None);
    assert_eq!(yes_no(&[c("1", "No", true), c("2", "Yes", false)], 0), None);
    // A word that only starts with the letters does not count.
    assert_eq!(yes_no(&[c("1", "Yesterday", true), c("2", "No", false)], 0), None);
    assert_eq!(yes_no(&[c("1", "Yes", true), c("2", "None of these", false)], 0), None);
    assert_eq!(yes_no(&[], 0), None);
    assert!(yes_no(&[c("1", "Yes", true), c("2", "No", false)], 0).is_some());
}

#[test]
fn labels_are_cut_to_60_characters() {
    let long = format!("No, {}", "é".repeat(80));
    let short = short_label(&long);
    assert_eq!(short.chars().count(), 60);
    assert!(short.ends_with('…'));
    assert_eq!(short_label("Yes"), "Yes");
    let exact = "x".repeat(60);
    assert_eq!(short_label(&exact), exact);
    let got = yes_no(&[c("1", "Yes", true), c("2", &long, false)], 0).unwrap();
    assert_eq!(got.no.label, short);
}

#[test]
fn label_matches_the_full_or_the_cut_label() {
    let long = format!("No, and tell Claude {}", "x".repeat(60));
    assert!(label_matches(&long, &long));
    assert!(label_matches(&long, &short_label(&long)));
    assert!(label_matches("Yes", "Yes"));
    assert!(!label_matches("Yes", "No"));
    assert!(!label_matches("Yes, and don't ask again", "Yes"));
}
