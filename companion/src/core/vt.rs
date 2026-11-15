//! The raw terminal stream of `pane.watch` with `format: "vt"`: the bytes of `terminal.attach`
//! as JSON events for a terminal emulator in the app. Pure: no I/O. `core::term_watch` gives it
//! the effects of [`super::attach::step`] and sends the events that it returns.
//!
//! Each attach attempt (`gen`) starts with a `reset` event at `seq` 0. The core's first paint
//! follows as `data`, so a fresh emulator gets the screen and the history. `seq` counts the
//! events of one `gen`, so the app finds a gap.

use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};

/// The most bytes in one `data` event (before base64).
pub const MAX_EVENT: usize = 48 * 1024;
/// A batch of this size goes out at once, without a wait for the next emit.
pub const MAX_BATCH: usize = 256 * 1024;

/// The bytes that wait for the next emit, and the numbers of the current attach.
#[derive(Debug, Default)]
pub struct Batch {
    /// The current attach. None before the first reset: bytes then have no emulator.
    gen: Option<u64>,
    seq: u64,
    buf: Vec<u8>,
}

impl Batch {
    fn next_seq(&mut self) -> u64 {
        self.seq += 1;
        self.seq
    }

    /// A new attach of `cols` × `rows`: the bytes of the old attach are dropped.
    pub fn reset(&mut self, gen: u64, cols: u16, rows: u16) -> Vec<Value> {
        self.gen = Some(gen);
        self.seq = 0;
        self.buf.clear();
        vec![json!({"vt": "reset", "gen": gen, "seq": 0, "cols": cols, "rows": rows})]
    }

    /// Keeps `bytes` for the next flush. A full batch flushes now.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Value> {
        if self.gen.is_none() {
            return vec![];
        }
        self.buf.extend_from_slice(bytes);
        if self.buf.len() >= MAX_BATCH {
            return self.flush();
        }
        vec![]
    }

    /// The terminal size changed: the waiting bytes go first, then the size.
    pub fn resize(&mut self, cols: u16, rows: u16) -> Vec<Value> {
        let Some(gen) = self.gen else { return vec![] };
        let mut out = self.flush();
        let seq = self.next_seq();
        out.push(json!({"vt": "resize", "gen": gen, "seq": seq, "cols": cols, "rows": rows}));
        out
    }

    /// The waiting bytes as `data` events of at most [`MAX_EVENT`] bytes. None when nothing waits.
    pub fn flush(&mut self) -> Vec<Value> {
        let Some(gen) = self.gen else { return vec![] };
        let buf = std::mem::take(&mut self.buf);
        buf.chunks(MAX_EVENT)
            .map(|c| {
                let seq = self.next_seq();
                json!({"vt": "data", "gen": gen, "seq": seq, "data": STANDARD.encode(c)})
            })
            .collect()
    }
}
