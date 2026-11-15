//! The pure rules of phone input to a Herdr 2 terminal: the key bytes, the frame kind and the
//! check after a send that timed out.

use herdlingd::core::frame;
use herdlingd::core::typing::{self, encode_key, encode_keys, Modes};
use serde_json::json;

fn k(spec: &str) -> Option<Vec<u8>> {
    encode_key(spec, Modes::default())
}

fn app(spec: &str) -> Option<Vec<u8>> {
    encode_key(spec, Modes { app_cursor: true })
}

#[test]
fn keys_encode_like_xterm() {
    let cases: &[(&str, &[u8])] = &[
        ("enter", b"\r"),
        ("Enter", b"\r"),
        ("return", b"\r"),
        ("tab", b"\t"),
        ("shift+tab", b"\x1b[Z"),
        ("backspace", b"\x7f"),
        ("esc", b"\x1b"),
        ("escape", b"\x1b"),
        ("space", b" "),
        ("ctrl+space", b"\x00"),
        ("a", b"a"),
        ("7", b"7"),
        ("/", b"/"),
        ("shift+a", b"A"),
        ("ctrl+c", b"\x03"),
        ("ctrl+a", b"\x01"),
        ("ctrl+z", b"\x1a"),
        ("ctrl+[", b"\x1b"),
        ("ctrl+\\", b"\x1c"),
        ("alt+x", b"\x1bx"),
        ("alt+enter", b"\x1b\r"),
        ("alt+backspace", b"\x1b\x7f"),
        ("up", b"\x1b[A"),
        ("down", b"\x1b[B"),
        ("right", b"\x1b[C"),
        ("left", b"\x1b[D"),
        ("home", b"\x1b[H"),
        ("end", b"\x1b[F"),
        ("ctrl+left", b"\x1b[1;5D"),
        ("shift+up", b"\x1b[1;2A"),
        ("alt+right", b"\x1b[1;3C"),
        ("insert", b"\x1b[2~"),
        ("delete", b"\x1b[3~"),
        ("pageup", b"\x1b[5~"),
        ("pagedown", b"\x1b[6~"),
        ("ctrl+delete", b"\x1b[3;5~"),
        ("f1", b"\x1bOP"),
        ("f4", b"\x1bOS"),
        ("f5", b"\x1b[15~"),
        ("f12", b"\x1b[24~"),
        ("shift+f1", b"\x1b[1;2P"),
    ];
    for (spec, want) in cases {
        assert_eq!(k(spec).as_deref(), Some(*want), "{spec}");
    }
}

#[test]
fn application_cursor_mode_changes_the_arrows() {
    assert_eq!(app("up").unwrap(), b"\x1bOA");
    assert_eq!(app("left").unwrap(), b"\x1bOD");
    assert_eq!(app("home").unwrap(), b"\x1bOH");
    // With a modifier the CSI form stays.
    assert_eq!(app("ctrl+up").unwrap(), b"\x1b[1;5A");
    assert_eq!(app("pageup").unwrap(), b"\x1b[5~");
}

#[test]
fn keys_with_no_legacy_form_go_to_the_core() {
    for spec in ["shift+enter", "ctrl+enter", "super+x", "cmd+c", "hyper+x", "f13", "ctrl+", "", "hello", "shift+1", "ctrl+1", "é"] {
        assert_eq!(k(spec), None, "{spec}");
    }
    let keys = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
    assert_eq!(encode_keys(&keys(&["esc", "x"]), Modes::default()), Some(vec![b"\x1b".to_vec(), b"x".to_vec()]));
    assert_eq!(encode_keys(&keys(&["esc", "shift+enter"]), Modes::default()), None);
    assert_eq!(encode_keys(&[], Modes::default()), Some(vec![]));
}

#[test]
fn the_frame_kind_needs_both_sides() {
    assert_eq!(typing::type_frame(true, true), frame::AUTOMATIC_INPUT);
    assert_eq!(typing::type_frame(true, false), frame::DATA);
    assert_eq!(typing::type_frame(false, true), frame::DATA);
    assert_eq!(typing::type_frame(false, false), frame::DATA);
}

#[test]
fn a_late_send_shows_a_new_turn_or_work() {
    let rec = |turn: u64, state: &str| json!({"turn": turn, "status": {"state": state}});
    assert!(!typing::late_send(&rec(3, "idle"), &rec(3, "idle")));
    assert!(typing::late_send(&rec(3, "idle"), &rec(4, "idle")));
    assert!(typing::late_send(&rec(3, "idle"), &rec(3, "working")));
    // An agent that was already working says nothing.
    assert!(!typing::late_send(&rec(3, "working"), &rec(3, "working")));
    // A shell has no turn and no status.
    assert!(!typing::late_send(&json!({}), &json!({})));
}

#[test]
fn the_input_bound_is_well_within_the_app_timeout() {
    assert!(typing::INPUT_TIMEOUT.as_secs() <= 10);
    assert_eq!(typing::busy_error().code, "busy");
    assert!(typing::busy_error().message.contains("Nothing was typed"));
    assert!(typing::unconfirmed_error().message.contains("Look at the terminal"));
}

#[test]
fn the_modes_come_from_the_first_paint() {
    assert_eq!(typing::modes_of(b"\x1b[H\x1b[2J$ "), Modes { app_cursor: false });
    assert_eq!(typing::modes_of(b"\x1b[?1h\x1b[H~"), Modes { app_cursor: true });
    assert_eq!(typing::modes_of(b"\x1b[?1h\x1b[?1l"), Modes { app_cursor: false });
}
