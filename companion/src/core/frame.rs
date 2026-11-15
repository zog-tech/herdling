//! The framed mode of the herdr-core socket (herdr-core `schema/README.md`, "Framed mode").
//! Each frame is `[channel u32 LE][kind u8][len u32 LE][payload]`. Channel 0 carries JSON-RPC;
//! an attach stream has its own channel. Pure: the I/O is in `core::term_watch`.

use serde_json::Value;

/// Channel 0: one JSON-RPC message. Other channels: stream bytes.
pub const DATA: u8 = 0;
/// u32 LE: the bytes that the receiver consumed.
pub const CREDIT: u8 = 1;
/// The channel is over. From the core, a JSON reason.
pub const CLOSE: u8 = 2;
/// u16 LE cols, u16 LE rows.
pub const RESIZE: u8 = 3;
/// Viewer to core: focus. herdlingd never sends it.
pub const FOCUS: u8 = 4;
/// Viewer to core: display facts. herdlingd never sends it.
pub const FACTS: u8 = 5;
/// Viewer to core: automatic answers. herdlingd never sends it.
pub const AUTOMATIC_INPUT: u8 = 6;

/// The length of a frame header.
pub const HEADER: usize = 9;
/// The largest payload that the core sends.
pub const MAX_PAYLOAD: usize = 16 << 20;

#[derive(Debug, Clone, PartialEq)]
pub struct Frame {
    pub channel: u32,
    pub kind: u8,
    pub payload: Vec<u8>,
}

/// A header that announces a payload larger than [`MAX_PAYLOAD`]. The connection is broken.
#[derive(Debug, Clone, PartialEq)]
pub struct TooLarge(pub usize);

/// One frame as bytes.
pub fn encode(channel: u32, kind: u8, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(HEADER + payload.len());
    out.extend(channel.to_le_bytes());
    out.push(kind);
    out.extend((payload.len() as u32).to_le_bytes());
    out.extend(payload);
    out
}

/// A CREDIT frame: the viewer consumed `n` bytes of `channel`.
pub fn credit(channel: u32, n: u32) -> Vec<u8> {
    encode(channel, CREDIT, &n.to_le_bytes())
}

/// A CLOSE frame from the viewer: it detaches from `channel`.
pub fn close(channel: u32) -> Vec<u8> {
    encode(channel, CLOSE, &[])
}

/// A JSON-RPC message on channel 0.
pub fn rpc(msg: &Value) -> Vec<u8> {
    encode(0, DATA, msg.to_string().as_bytes())
}

/// The `(cols, rows)` of a RESIZE payload.
pub fn size(payload: &[u8]) -> Option<(u16, u16)> {
    let p: [u8; 4] = payload.try_into().ok()?;
    Some((u16::from_le_bytes([p[0], p[1]]), u16::from_le_bytes([p[2], p[3]])))
}

/// Collects bytes and gives the complete frames in order.
#[derive(Default)]
pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn push(&mut self, bytes: &[u8]) {
        self.buf.extend_from_slice(bytes);
    }

    /// The next complete frame, `Ok(None)` when more bytes are necessary.
    pub fn next(&mut self) -> Result<Option<Frame>, TooLarge> {
        if self.buf.len() < HEADER {
            return Ok(None);
        }
        let len = u32::from_le_bytes([self.buf[5], self.buf[6], self.buf[7], self.buf[8]]) as usize;
        if len > MAX_PAYLOAD {
            return Err(TooLarge(len));
        }
        if self.buf.len() < HEADER + len {
            return Ok(None);
        }
        let channel = u32::from_le_bytes([self.buf[0], self.buf[1], self.buf[2], self.buf[3]]);
        let kind = self.buf[4];
        let payload = self.buf[HEADER..HEADER + len].to_vec();
        self.buf.drain(..HEADER + len);
        Ok(Some(Frame { channel, kind, payload }))
    }
}
