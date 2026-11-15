//! The emulator and the ANSI render of a Herdr 2 terminal (`core::screen`).

use herdlingd::core::screen::Emulator;

fn render(cols: u16, rows: u16, history: usize, bytes: &str) -> herdlingd::core::screen::Render {
    let mut e = Emulator::new(cols, rows, history);
    e.feed(bytes.as_bytes());
    e.render(true)
}

#[test]
fn plain_lines_join_with_newlines() {
    let r = render(20, 5, 10, "hi\r\nthere");
    assert_eq!(r.text, "hi\nthere");
    assert_eq!((r.rows, r.history, r.alternate), (5, 0, false));
}

#[test]
fn basic_colors_become_sgr() {
    assert_eq!(render(20, 3, 0, "\x1b[31mred\x1b[0m ok").text, "\x1b[0;31mred\x1b[0m ok");
    assert_eq!(render(20, 3, 0, "\x1b[91mhi").text, "\x1b[0;91mhi\x1b[0m");
    assert_eq!(render(20, 3, 0, "\x1b[44mbg").text, "\x1b[0;44mbg\x1b[0m");
}

#[test]
fn extended_colors_and_attributes() {
    assert_eq!(render(20, 3, 0, "\x1b[38;5;208mo").text, "\x1b[0;38;5;208mo\x1b[0m");
    assert_eq!(render(20, 3, 0, "\x1b[38;2;1;2;3;48;2;4;5;6mx").text, "\x1b[0;38;2;1;2;3;48;2;4;5;6mx\x1b[0m");
    assert_eq!(render(20, 3, 0, "\x1b[1;3;4;7mx").text, "\x1b[0;1;3;4;7mx\x1b[0m");
    // Bold and dim share one intensity: the last one wins.
    assert_eq!(render(20, 3, 0, "\x1b[1;2mx").text, "\x1b[0;2mx\x1b[0m");
}

#[test]
fn text_format_has_no_escapes() {
    let mut e = Emulator::new(20, 3, 0);
    e.feed(b"\x1b[31mred\x1b[0m ok");
    assert_eq!(e.render(false).text, "red ok");
}

#[test]
fn trailing_blanks_are_cut_but_a_colored_background_stays() {
    assert_eq!(render(20, 3, 0, "ab   ").text, "ab");
    assert_eq!(render(10, 3, 0, "\x1b[41mab  \x1b[0m").text, "\x1b[0;41mab  \x1b[0m");
}

#[test]
fn history_comes_before_the_screen() {
    let lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
    let r = render(20, 10, 50, &lines.join("\r\n"));
    assert_eq!(r.history, 20);
    let out: Vec<&str> = r.text.split('\n').collect();
    assert_eq!(out.len(), 30);
    assert_eq!(out[0], "line 1");
    assert_eq!(out[29], "line 30");
}

#[test]
fn history_is_capped() {
    let lines: Vec<String> = (1..=30).map(|n| format!("line {n}")).collect();
    let r = render(20, 10, 5, &lines.join("\r\n"));
    assert_eq!(r.history, 5);
    assert_eq!(r.text.split('\n').next(), Some("line 16"));
}

#[test]
fn alternate_screen_keeps_every_row_and_no_history() {
    let r = render(20, 4, 50, "old\r\nlines\r\n\x1b[?1049h\x1b[Htop");
    assert!(r.alternate);
    assert_eq!(r.history, 0);
    assert_eq!(r.text, "top\n\n\n");
}

#[test]
fn wide_characters_show_once() {
    assert_eq!(render(20, 2, 0, "a界b").text, "a界b");
}

#[test]
fn resize_keeps_the_bottom_rows() {
    let mut e = Emulator::new(20, 4, 10);
    e.feed(b"1\r\n2\r\n3\r\n4");
    e.resize(20, 2);
    let r = e.render(false);
    assert_eq!(r.rows, 2);
    assert!(r.text.ends_with("3\n4"), "{:?}", r.text);
}

#[test]
fn a_paint_that_starts_with_can_and_clears() {
    let r = render(20, 3, 10, "junk\x18\x1b[H\x1b[2J\x1b[32mok\x1b[0m");
    assert!(r.text.ends_with("\x1b[0;32mok\x1b[0m"), "{:?}", r.text);
    assert!(!r.text.contains("junk") || r.history > 0);
}

#[test]
fn a_zero_size_does_not_panic() {
    let mut e = Emulator::new(0, 0, 0);
    e.feed(b"x");
    e.resize(0, 0);
    assert_eq!(e.render(false).text, "x");
}
