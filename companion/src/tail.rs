//! Read lines of a large log in bounded chunks: backward from the end (pages, previews) and
//! forward from an offset (follow, incremental scans).
//!
//! Agent logs can be very large, and one line can hold a multi-megabyte base64 image. The
//! readers here never load more than one block plus one line, and a line longer than
//! [`LINE_CAP`] is clipped: each JSON string in it keeps at most [`STRING_CAP`] bytes. The
//! clipped line stays valid JSON, so the parsers still see its type, ids and short fields.

use std::io::{self, Read, Seek, SeekFrom};

/// Block size for chunked reads.
pub const BLOCK: u64 = 64 * 1024;
/// A line longer than this (in bytes) is clipped.
pub const LINE_CAP: usize = 2 * 1024 * 1024;
/// Most bytes kept of one JSON string in a clipped line.
pub const STRING_CAP: usize = 64 * 1024;

/// A complete line and the byte offset where it starts.
pub type OffsetLine = (u64, String);

/// Cuts long JSON strings out of a stream of line bytes. A string is cut at a character
/// boundary, never inside an escape or between the two halves of a surrogate pair. The
/// closing quote stays, so valid JSON stays valid. Output past [`LINE_CAP`] is an overflow.
#[derive(Debug, Default)]
pub struct LineCutter {
    out: Vec<u8>,
    in_str: bool,
    /// The previous byte was a backslash.
    after_bs: bool,
    /// Hex digits of a `\u` escape still to come.
    hex_left: u8,
    hex: u16,
    /// The last escape was a high surrogate: the next escape must stay with it.
    high: bool,
    str_len: usize,
    skipping: bool,
    overflow: bool,
}

impl LineCutter {
    pub fn new() -> LineCutter {
        LineCutter::default()
    }

    /// Feeds the next bytes of the line.
    pub fn push(&mut self, bytes: &[u8]) {
        let mut i = 0;
        while i < bytes.len() {
            if self.overflow {
                return;
            }
            if self.skipping && !self.after_bs && self.hex_left == 0 {
                // Fast path through the cut part of a long string (a base64 image): only a
                // quote or a backslash changes the state.
                match bytes[i..].iter().position(|c| *c == b'"' || *c == b'\\') {
                    Some(k) => i += k,
                    None => return,
                }
            }
            self.byte(bytes[i]);
            i += 1;
            if self.out.len() > LINE_CAP {
                self.overflow = true;
                self.out = Vec::new();
            }
        }
    }

    fn byte(&mut self, b: u8) {
        if !self.in_str {
            self.out.push(b);
            if b == b'"' {
                self.in_str = true;
                self.str_len = 0;
                self.skipping = false;
                self.high = false;
            }
            return;
        }
        let full = self.str_len >= STRING_CAP;
        if self.after_bs {
            self.after_bs = false;
            if b == b'u' {
                self.hex_left = 4;
                self.hex = 0;
            } else {
                self.high = false;
            }
        } else if self.hex_left > 0 {
            self.hex_left -= 1;
            self.hex = self.hex.wrapping_mul(16).wrapping_add((b as char).to_digit(16).unwrap_or(0) as u16);
            if self.hex_left == 0 {
                self.high = (0xD800..=0xDBFF).contains(&self.hex);
            }
        } else if b == b'\\' {
            if full && !self.skipping && !self.high {
                self.skipping = true;
            }
            self.after_bs = true;
        } else if b == b'"' {
            self.in_str = false;
            self.skipping = false;
            self.out.push(b);
            return;
        } else {
            // A UTF-8 continuation byte is not a character boundary.
            if full && !self.skipping && (b & 0xC0) != 0x80 {
                self.skipping = true;
            }
            if (b & 0xC0) != 0x80 {
                self.high = false;
            }
        }
        if !self.skipping {
            self.out.push(b);
            self.str_len += 1;
        }
    }

    /// The clipped bytes, or `None` when even the clipped line is longer than [`LINE_CAP`].
    pub fn finish(self) -> Option<Vec<u8>> {
        (!self.overflow && self.out.len() <= LINE_CAP).then_some(self.out)
    }
}

/// `bytes` as one line: as they are when short, clipped when longer than [`LINE_CAP`].
/// A line that stays too long after the clip gives an empty line.
pub fn clip_line(bytes: &[u8]) -> Vec<u8> {
    if bytes.len() <= LINE_CAP {
        return bytes.to_vec();
    }
    let mut c = LineCutter::new();
    c.push(bytes);
    c.finish().unwrap_or_default()
}

/// Text of a line: lossy UTF-8 without the line end.
fn text(bytes: Vec<u8>) -> String {
    let mut s = match String::from_utf8(bytes) {
        Ok(s) => s,
        Err(e) => String::from_utf8_lossy(e.as_bytes()).into_owned(),
    };
    let keep = s.trim_end_matches(['\n', '\r']).len();
    s.truncate(keep);
    s
}

/// Reads the bytes `[start, end)` as one line. A line longer than [`LINE_CAP`] is read in
/// blocks through a [`LineCutter`].
pub fn read_span<R: Read + Seek>(r: &mut R, start: u64, end: u64) -> io::Result<Vec<u8>> {
    let n = end.saturating_sub(start);
    r.seek(SeekFrom::Start(start))?;
    if n as usize <= LINE_CAP {
        let mut buf = vec![0u8; n as usize];
        r.read_exact(&mut buf)?;
        return Ok(buf);
    }
    let mut c = LineCutter::new();
    let mut buf = vec![0u8; BLOCK as usize];
    let mut left = n;
    while left > 0 {
        let k = BLOCK.min(left) as usize;
        r.read_exact(&mut buf[..k])?;
        c.push(&buf[..k]);
        left -= k as u64;
    }
    Ok(c.finish().unwrap_or_default())
}

/// Read up to `max_items` complete lines that end at byte `before` (default EOF), in file
/// order, each with its start offset. Blank lines are skipped.
pub fn read_offset_lines_before<R: Read + Seek>(
    r: R,
    before: Option<u64>,
    max_items: usize,
) -> io::Result<Vec<OffsetLine>> {
    read_offset_lines_within(r, before, max_items, u64::MAX)
}

/// Like [`read_offset_lines_before`], but only lines that start at most `max_back` bytes
/// before the end. The scan reads blocks backward and keeps only the line starts.
pub fn read_offset_lines_within<R: Read + Seek>(
    mut r: R,
    before: Option<u64>,
    max_items: usize,
    max_back: u64,
) -> io::Result<Vec<OffsetLine>> {
    let len = r.seek(SeekFrom::End(0))?;
    let end = before.map_or(len, |b| b.min(len));
    if max_items == 0 || end == 0 {
        return Ok(Vec::new());
    }
    let floor = end.saturating_sub(max_back);
    // Line starts before `end`, newest first. Each start opens one piece.
    let mut starts: Vec<u64> = Vec::new();
    let mut pos = end;
    let mut buf = vec![0u8; BLOCK as usize];
    'scan: while starts.len() < max_items && pos > floor {
        let n = BLOCK.min(pos - floor) as usize;
        pos -= n as u64;
        r.seek(SeekFrom::Start(pos))?;
        r.read_exact(&mut buf[..n])?;
        let mut rest = &buf[..n];
        while let Some(i) = rest.iter().rposition(|c| *c == b'\n') {
            rest = &rest[..i];
            let s = pos + i as u64 + 1;
            if s < end {
                starts.push(s);
                if starts.len() == max_items {
                    break 'scan;
                }
            }
        }
    }
    if starts.len() < max_items && pos == 0 {
        // The start of the file opens the first line. A piece before the oldest start that
        // does not reach the start of the file is cut off and dropped.
        starts.push(0);
    }
    starts.reverse();
    let mut out = Vec::with_capacity(starts.len());
    for (i, &s) in starts.iter().enumerate() {
        let e = starts.get(i + 1).copied().unwrap_or(end);
        let t = text(read_span(&mut r, s, e)?);
        if !t.trim().is_empty() {
            out.push((s, t));
        }
    }
    Ok(out)
}

/// The offset just past the first newline at or after `pos`, or `None` when no newline follows.
pub fn next_line_start<R: Read + Seek>(r: &mut R, pos: u64) -> io::Result<Option<u64>> {
    r.seek(SeekFrom::Start(pos))?;
    let mut buf = vec![0u8; BLOCK as usize];
    let mut at = pos;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            return Ok(None);
        }
        if let Some(i) = buf[..n].iter().position(|c| *c == b'\n') {
            return Ok(Some(at + i as u64 + 1));
        }
        at += n as u64;
    }
}

/// Read the complete lines from `start` (a line start) forward. Stops before the first line
/// that starts at or past `start + budget`, so a read returns at least one line when one is
/// complete. A last line with no newline is still being written: it is left for a later read.
/// Returns the lines (blank lines skipped) and the offset after the last complete line.
pub fn read_lines_from<R: Read + Seek>(r: &mut R, start: u64, budget: u64) -> io::Result<(Vec<OffsetLine>, u64)> {
    r.seek(SeekFrom::Start(start))?;
    let mut out = Vec::new();
    let mut buf = vec![0u8; BLOCK as usize];
    let mut cur: Vec<u8> = Vec::new();
    let mut clip: Option<LineCutter> = None;
    let mut line_start = start;
    let mut at = start;
    loop {
        let n = r.read(&mut buf)?;
        if n == 0 {
            return Ok((out, line_start));
        }
        let mut chunk = &buf[..n];
        while !chunk.is_empty() {
            let nl = chunk.iter().position(|c| *c == b'\n');
            let piece = &chunk[..nl.unwrap_or(chunk.len())];
            match &mut clip {
                Some(c) => c.push(piece),
                None if cur.len() + piece.len() > LINE_CAP => {
                    let mut c = LineCutter::new();
                    c.push(&cur);
                    c.push(piece);
                    cur = Vec::new();
                    clip = Some(c);
                }
                None => cur.extend_from_slice(piece),
            }
            let Some(i) = nl else {
                at += chunk.len() as u64;
                break;
            };
            at += i as u64 + 1;
            chunk = &chunk[i + 1..];
            let bytes = match clip.take() {
                Some(c) => c.finish().unwrap_or_default(),
                None => std::mem::take(&mut cur),
            };
            let t = text(bytes);
            if !t.trim().is_empty() {
                out.push((line_start, t));
            }
            line_start = at;
            if line_start - start >= budget {
                return Ok((out, line_start));
            }
        }
    }
}

/// Read up to `max_lines` complete lines from the start of a file, within `max_bytes`.
pub fn head_lines<R: Read + Seek>(r: &mut R, max_lines: usize, max_bytes: u64) -> io::Result<Vec<OffsetLine>> {
    let mut out: Vec<OffsetLine> = Vec::new();
    let mut at = 0u64;
    while out.len() < max_lines && at < max_bytes {
        let (lines, next) = read_lines_from(r, at, BLOCK)?;
        if next == at {
            break;
        }
        out.extend(lines);
        at = next;
    }
    out.truncate(max_lines);
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn lines(data: &[u8], before: Option<u64>, n: usize) -> Vec<OffsetLine> {
        read_offset_lines_before(Cursor::new(data.to_vec()), before, n).unwrap()
    }

    #[test]
    fn backward_line_across_block_boundary() {
        let a = "a".repeat(BLOCK as usize - 3);
        let b = "b".repeat(100);
        let data = format!("{a}\n{b}\nc\n");
        let got = lines(data.as_bytes(), None, 2);
        assert_eq!(got, vec![(a.len() as u64 + 1, b.clone()), (a.len() as u64 + b.len() as u64 + 2, "c".into())]);
        let all = lines(data.as_bytes(), None, 10);
        assert_eq!(all.len(), 3);
        assert_eq!(all[0], (0, a));
    }

    #[test]
    fn backward_crlf_and_blank_lines() {
        let got = lines(b"one\r\n\r\ntwo\r\n", None, 10);
        assert_eq!(got, vec![(0, "one".into()), (7, "two".into())]);
    }

    #[test]
    fn backward_partial_tail_is_a_line() {
        // A page keeps a partial tail: the caller checks it is valid JSON.
        let got = lines(b"{\"a\":1}\n{\"b\":", None, 10);
        assert_eq!(got, vec![(0, "{\"a\":1}".into()), (8, "{\"b\":".into())]);
    }

    #[test]
    fn backward_before_offset_and_budget() {
        let data = b"l1\nl2\nl3\nl4\n";
        assert_eq!(lines(data, Some(6), 10), vec![(0, "l1".into()), (3, "l2".into())]);
        // With a budget of 7 bytes, only the lines that start at byte 5 or later are read.
        let got = read_offset_lines_within(Cursor::new(data.to_vec()), None, 10, 7).unwrap();
        assert_eq!(got, vec![(6, "l3".into()), (9, "l4".into())]);
    }

    #[test]
    fn huge_line_is_clipped_and_stays_json() {
        let data = "Q".repeat(LINE_CAP + 10);
        let line = format!("{{\"type\":\"user\",\"data\":\"{data}\",\"text\":\"hi\"}}");
        let input = format!("{{\"x\":1}}\n{line}\n{{\"y\":2}}\n");
        let got = lines(input.as_bytes(), None, 10);
        assert_eq!(got.len(), 3);
        assert_eq!(got[1].0, 8);
        let v: serde_json::Value = serde_json::from_str(&got[1].1).unwrap();
        assert_eq!(v["type"], "user");
        assert_eq!(v["text"], "hi");
        assert_eq!(v["data"].as_str().unwrap().len(), STRING_CAP);
        assert_eq!(got[2], (8 + line.len() as u64 + 1, "{\"y\":2}".into()));
    }

    #[test]
    fn cutter_keeps_escapes_and_utf8_whole() {
        // Every char is a 3-byte UTF-8 char, an escape or a surrogate pair.
        let body = "é\\n\\ud83d\\ude00€".repeat(LINE_CAP / 8);
        let line = format!("{{\"s\":\"{body}\"}}");
        assert!(line.len() > LINE_CAP);
        let out = clip_line(line.as_bytes());
        let v: serde_json::Value = serde_json::from_str(std::str::from_utf8(&out).unwrap()).unwrap();
        let s = v["s"].as_str().unwrap();
        assert!(!s.is_empty() && s.len() < STRING_CAP + 16);
    }

    #[test]
    fn line_cutter_overflow_gives_empty_line() {
        // Many short strings: the clip cannot bring the line under the cap.
        let line = format!("[{}\"x\"]", "\"abcdefgh\",".repeat(LINE_CAP / 8));
        assert!(clip_line(line.as_bytes()).is_empty());
    }

    #[test]
    fn forward_reads_complete_lines_and_leaves_partial_tail() {
        let mut c = Cursor::new(b"a\r\n\nbb\ncc".to_vec());
        let (got, next) = read_lines_from(&mut c, 0, u64::MAX).unwrap();
        assert_eq!(got, vec![(0, "a".into()), (4, "bb".into())]);
        assert_eq!(next, 7);
        let (got, next) = read_lines_from(&mut c, 7, u64::MAX).unwrap();
        assert!(got.is_empty());
        assert_eq!(next, 7);
    }

    #[test]
    fn forward_budget_and_block_boundary() {
        let a = "a".repeat(BLOCK as usize + 5);
        let data = format!("{a}\nb\nc\n");
        let mut c = Cursor::new(data.into_bytes());
        // The first line passes the budget: the read stops after it.
        let (got, next) = read_lines_from(&mut c, 0, 10).unwrap();
        assert_eq!(got, vec![(0, a.clone())]);
        assert_eq!(next, a.len() as u64 + 1);
        let (got, _) = read_lines_from(&mut c, next, 10).unwrap();
        assert_eq!(got.iter().map(|l| l.1.as_str()).collect::<Vec<_>>(), ["b", "c"]);
    }

    #[test]
    fn forward_huge_line_is_clipped() {
        let data = "Z".repeat(LINE_CAP * 2);
        let input = format!("{{\"d\":\"{data}\",\"k\":1}}\n{{\"n\":2}}\n");
        let mut c = Cursor::new(input.into_bytes());
        let (got, _) = read_lines_from(&mut c, 0, u64::MAX).unwrap();
        assert_eq!(got.len(), 2);
        let v: serde_json::Value = serde_json::from_str(&got[0].1).unwrap();
        assert_eq!(v["k"], 1);
        assert_eq!(v["d"].as_str().unwrap().len(), STRING_CAP);
    }

    #[test]
    fn head_lines_limits() {
        let mut c = Cursor::new(b"1\n2\n3\n4".to_vec());
        let got = head_lines(&mut c, 2, u64::MAX).unwrap();
        assert_eq!(got, vec![(0, "1".into()), (2, "2".into())]);
        let got = head_lines(&mut c, 10, u64::MAX).unwrap();
        assert_eq!(got.len(), 3);
    }

    #[test]
    fn next_line_start_finds_newline() {
        let mut c = Cursor::new(b"abc\ndef".to_vec());
        assert_eq!(next_line_start(&mut c, 1).unwrap(), Some(4));
        assert_eq!(next_line_start(&mut c, 4).unwrap(), None);
    }
}
