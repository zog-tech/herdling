//! Read the last lines of a large file without reading the whole file.

use std::io::{self, Read, Seek, SeekFrom};

/// Block size for backward reads.
pub const BLOCK: u64 = 64 * 1024;

/// A complete line and the byte offset where it starts.
pub type OffsetLine = (u64, String);

/// Read up to `max_items` complete lines that end at byte `before` (default EOF), in file
/// order, each with its start offset. Blank lines are skipped.
pub fn read_offset_lines_before<R: Read + Seek>(
    mut r: R,
    before: Option<u64>,
    max_items: usize,
) -> io::Result<Vec<OffsetLine>> {
    let len = r.seek(SeekFrom::End(0))?;
    let end = before.map_or(len, |b| b.min(len));
    if max_items == 0 || end == 0 {
        return Ok(Vec::new());
    }
    let mut blocks: Vec<Vec<u8>> = Vec::new();
    let mut pos = end;
    let mut newlines = 0usize;
    // Need max_items + 1 newlines: one terminates the partial line before the first kept line.
    while pos > 0 && newlines <= max_items {
        let n = BLOCK.min(pos);
        pos -= n;
        r.seek(SeekFrom::Start(pos))?;
        let mut b = vec![0u8; n as usize];
        r.read_exact(&mut b)?;
        newlines += b.iter().filter(|c| **c == b'\n').count();
        blocks.push(b);
    }
    blocks.reverse();
    let buf: Vec<u8> = blocks.concat();
    let mut start = 0usize;
    if pos > 0 {
        // The first line is cut off. Drop it.
        match buf.iter().position(|c| *c == b'\n') {
            Some(i) => start = i + 1,
            None => return Ok(Vec::new()),
        }
    }
    let region = &buf[start..];
    let pieces: Vec<&[u8]> = region.split_inclusive(|c| *c == b'\n').collect();
    let keep = pieces.len().saturating_sub(max_items);
    let mut off = pos + start as u64 + pieces[..keep].iter().map(|p| p.len() as u64).sum::<u64>();
    let mut out = Vec::new();
    for p in &pieces[keep..] {
        let line_off = off;
        off += p.len() as u64;
        let text = String::from_utf8_lossy(p);
        let text = text.trim_end_matches(['\n', '\r']);
        if !text.trim().is_empty() {
            out.push((line_off, text.to_string()));
        }
    }
    Ok(out)
}
