//! The screen of a Herdr 2 terminal as herdr 1 `pane.read` text. `terminal.attach` gives raw
//! program output; a terminal emulator (`vt100`) keeps the grid and the history, and
//! [`Emulator::render`] writes the lines with only the SGR codes that the app's
//! `terminal/ansi.ts` knows. Pure: no I/O. The emulator never writes answers back.

use std::num::NonZeroU16;

use vt100::{Cell, Color, Parser};

/// Bounds for the grid, so a strange size cannot use much memory.
const MAX_COLS: u16 = 1000;
const MAX_ROWS: u16 = 500;

/// The text of one render.
#[derive(Debug, Clone, PartialEq)]
pub struct Render {
    /// History lines (oldest first), then the screen rows, joined with `\n`.
    pub text: String,
    /// The program draws on the alternate screen (a full-screen app).
    pub alternate: bool,
    /// The rows of the grid.
    pub rows: u16,
    /// The number of history lines in `text`.
    pub history: usize,
}

pub struct Emulator {
    parser: Parser,
}

fn dim(n: u16, max: u16) -> NonZeroU16 {
    NonZeroU16::new(n.clamp(1, max)).unwrap_or(NonZeroU16::MIN)
}

/// The style of a cell that the render writes.
#[derive(Debug, Clone, Copy, PartialEq, Default)]
struct Style {
    fg: Color,
    bg: Color,
    bold: bool,
    dim: bool,
    italic: bool,
    underline: bool,
    inverse: bool,
}

impl Style {
    fn of(c: &Cell) -> Style {
        Style {
            fg: c.fgcolor(),
            bg: c.bgcolor(),
            bold: c.bold(),
            dim: c.dim(),
            italic: c.italic(),
            underline: c.underline(),
            inverse: c.inverse(),
        }
    }

    /// The SGR that sets this style from the default style.
    fn sgr(&self) -> String {
        let mut s = String::from("\x1b[0");
        for (on, code) in [(self.bold, 1), (self.dim, 2), (self.italic, 3), (self.underline, 4), (self.inverse, 7)] {
            if on {
                s.push_str(&format!(";{code}"));
            }
        }
        color(&mut s, self.fg, 30, 90, 38);
        color(&mut s, self.bg, 40, 100, 48);
        s.push('m');
        s
    }
}

fn color(s: &mut String, c: Color, base: u8, bright: u8, ext: u8) {
    match c {
        Color::Default => {}
        Color::Idx(n @ 0..=7) => s.push_str(&format!(";{}", base + n)),
        Color::Idx(n @ 8..=15) => s.push_str(&format!(";{}", bright + n - 8)),
        Color::Idx(n) => s.push_str(&format!(";{ext};5;{n}")),
        Color::Rgb(r, g, b) => s.push_str(&format!(";{ext};2;{r};{g};{b}")),
    }
}

/// A cell that shows nothing: no text, the default background, not inverse or underlined.
fn blank(c: &Cell) -> bool {
    let text = c.contents();
    (text.is_empty() || text == " ") && c.bgcolor() == Color::Default && !c.inverse() && !c.underline()
}

impl Emulator {
    /// An emulator of `cols` × `rows` (0 counts as 1) that keeps `history` lines.
    pub fn new(cols: u16, rows: u16, history: usize) -> Emulator {
        Emulator { parser: Parser::new(dim(rows, MAX_ROWS), dim(cols, MAX_COLS), history) }
    }

    pub fn feed(&mut self, bytes: &[u8]) {
        self.parser.process(bytes);
    }

    pub fn resize(&mut self, cols: u16, rows: u16) {
        self.parser.set_size(dim(rows, MAX_ROWS), dim(cols, MAX_COLS));
    }

    pub fn alternate(&self) -> bool {
        self.parser.screen().alternate_screen()
    }

    pub fn rows(&self) -> u16 {
        self.parser.screen().size().0.get()
    }

    /// The history and the screen as text, with SGR when `ansi`.
    pub fn render(&mut self, ansi: bool) -> Render {
        let alternate = self.alternate();
        let (rows, cols) = {
            let (r, c) = self.parser.screen().size();
            (r.get(), c.get())
        };
        let screen = self.parser.screen_mut();
        let mut lines = Vec::new();
        // History (the main screen only): with the view `s` lines up, row 0 is history line
        // `len - s`. Read it in blocks of `rows`, then go back to the live view.
        let mut history = 0;
        if !alternate {
            screen.set_scrollback(usize::MAX);
            let len = screen.scrollback();
            let mut s = len;
            while s > 0 {
                screen.set_scrollback(s);
                let take = s.min(rows as usize);
                for row in 0..take as u16 {
                    lines.push(line(screen, row, cols, ansi));
                }
                s -= take;
            }
            screen.set_scrollback(0);
            history = len;
        }
        let mut shown: Vec<String> = (0..rows).map(|row| line(screen, row, cols, ansi)).collect();
        if !alternate {
            while shown.last().is_some_and(|l| l.is_empty()) {
                shown.pop();
            }
        }
        lines.extend(shown);
        Render { text: lines.join("\n"), alternate, rows, history }
    }
}

/// One visible row: its cells up to the last cell that shows something.
fn line(screen: &vt100::Screen, row: u16, cols: u16, ansi: bool) -> String {
    let cells: Vec<&Cell> = (0..cols).filter_map(|col| screen.cell(row, col)).collect();
    let end = cells.iter().rposition(|c| !blank(c)).map_or(0, |i| i + 1);
    let mut out = String::new();
    let mut style = Style::default();
    for c in &cells[..end] {
        if c.is_wide_continuation() {
            continue;
        }
        if ansi {
            let s = Style::of(c);
            if s != style {
                out.push_str(&s.sgr());
                style = s;
            }
        }
        let text = c.contents();
        out.push_str(if text.is_empty() { " " } else { text });
    }
    if ansi && style != Style::default() {
        out.push_str("\x1b[0m");
    }
    out
}
