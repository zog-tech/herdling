//! Pure parts of the mirror stream: the scrcpy video demuxer, the H.264 Annex B splitter, the
//! frame cache for a new viewer, and the binary messages to the page.
//!
//! The page gets one H.264 access unit (Annex B) per message. A key frame carries the SPS and PPS
//! first, so the page can configure its decoder from any key frame.

use std::collections::VecDeque;

/// The scrcpy codec id of H.264 (`"h264"`).
pub const CODEC_H264: u32 = 0x6832_3634;
/// The largest packet accepted from scrcpy.
pub const MAX_PACKET: usize = 16 << 20;
/// At most this many units in the cache.
pub const CACHE_UNITS: usize = 300;
/// At most this many bytes in the cache.
pub const CACHE_BYTES: usize = 16 << 20;

/// The kind byte of a binary message to the page.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FrameKind {
    H264 = 1,
    Jpeg = 2,
    Png = 3,
}

/// One message to the page: the 2-byte header and the payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Frame {
    /// Increases by one for each frame of a session.
    pub seq: u64,
    pub key: bool,
    /// The whole message: kind, flags, payload.
    pub msg: axum::body::Bytes,
}

/// The message bytes for a frame: kind, flags (bit 0: key frame), payload.
pub fn encode(kind: FrameKind, key: bool, payload: &[u8]) -> Vec<u8> {
    let mut m = Vec::with_capacity(payload.len() + 2);
    m.push(kind as u8);
    m.push(u8::from(key));
    m.extend_from_slice(payload);
    m
}

/// What the scrcpy demuxer gives.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Demuxed {
    /// A new capture session with this video size (also after a rotation).
    Session { width: u32, height: u32 },
    /// One access unit. A key frame has the last config packet (SPS, PPS) in front.
    Unit { key: bool, data: Vec<u8> },
}

/// Why the scrcpy stream cannot be read.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum DemuxError {
    #[error("the device did not start the video stream (code {0})")]
    Disabled(u32),
    #[error("the device sends codec {0:#010x}, not H.264")]
    Codec(u32),
    #[error("a packet of {0} bytes is too large")]
    TooLarge(usize),
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum DemuxState {
    /// Waits for the 4-byte codec id.
    Codec,
    /// Waits for a 12-byte header.
    Header,
    /// Waits for `size` payload bytes.
    Payload { size: usize, config: bool, key: bool },
}

/// The video socket of the scrcpy server (with `send_device_meta=false`): the codec id, then
/// session packets and media packets. See `doc/develop.md` of scrcpy, "Video and audio".
#[derive(Debug, Clone)]
pub struct ScrcpyDemux {
    state: DemuxState,
    buf: Vec<u8>,
    config: Vec<u8>,
}

impl Default for ScrcpyDemux {
    fn default() -> Self {
        ScrcpyDemux { state: DemuxState::Codec, buf: Vec::new(), config: Vec::new() }
    }
}

impl ScrcpyDemux {
    /// Adds bytes and returns the complete items.
    pub fn feed(&mut self, bytes: &[u8]) -> Result<Vec<Demuxed>, DemuxError> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        let mut pos = 0;
        loop {
            let rest = &self.buf[pos..];
            match self.state {
                DemuxState::Codec => {
                    if rest.len() < 4 {
                        break;
                    }
                    let id = u32::from_be_bytes([rest[0], rest[1], rest[2], rest[3]]);
                    pos += 4;
                    match id {
                        CODEC_H264 => self.state = DemuxState::Header,
                        0 | 1 => return Err(DemuxError::Disabled(id)),
                        other => return Err(DemuxError::Codec(other)),
                    }
                }
                DemuxState::Header => {
                    if rest.len() < 12 {
                        break;
                    }
                    let head = u64::from_be_bytes(rest[..8].try_into().unwrap_or_default());
                    let tail = u32::from_be_bytes(rest[8..12].try_into().unwrap_or_default());
                    pos += 12;
                    if head >> 63 == 1 {
                        // Session packet: flags (u32), width (u32), height (u32).
                        out.push(Demuxed::Session { width: (head & 0xffff_ffff) as u32, height: tail });
                    } else {
                        let size = tail as usize;
                        if size > MAX_PACKET {
                            return Err(DemuxError::TooLarge(size));
                        }
                        self.state = DemuxState::Payload { size, config: head >> 62 & 1 == 1, key: head >> 61 & 1 == 1 };
                    }
                }
                DemuxState::Payload { size, config, key } => {
                    if rest.len() < size {
                        break;
                    }
                    let data = &rest[..size];
                    if config {
                        self.config = data.to_vec();
                    } else {
                        let mut unit = Vec::with_capacity(size + if key { self.config.len() } else { 0 });
                        if key {
                            unit.extend_from_slice(&self.config);
                        }
                        unit.extend_from_slice(data);
                        out.push(Demuxed::Unit { key, data: unit });
                    }
                    pos += size;
                    self.state = DemuxState::Header;
                }
            }
        }
        self.buf.drain(..pos);
        Ok(out)
    }
}

/// The NAL unit type (low 5 bits of the first byte).
pub fn nal_type(nal: &[u8]) -> u8 {
    nal.first().map_or(0, |b| b & 0x1f)
}

/// True for a slice NAL whose `first_mb_in_slice` is 0: the first slice of a picture.
fn first_slice(nal: &[u8]) -> bool {
    matches!(nal_type(nal), 1 | 5) && nal.get(1).is_some_and(|b| b & 0x80 != 0)
}

/// Finds the next start code (`00 00 01`) at or after `from`. Returns its index and length (3,
/// or 4 with a zero byte before it).
fn find_start(b: &[u8], from: usize) -> Option<(usize, usize)> {
    let mut i = from;
    while i + 3 <= b.len() {
        if b[i] == 0 && b[i + 1] == 0 && b[i + 2] == 1 {
            return Some(if i > from && b[i - 1] == 0 { (i - 1, 4) } else { (i, 3) });
        }
        i += 1;
    }
    None
}

/// One access unit from the Annex B splitter.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Unit {
    /// True when the unit has an IDR slice. The splitter puts the last SPS and PPS in front.
    pub key: bool,
    /// Annex B bytes: each NAL with a 4-byte start code.
    pub data: Vec<u8>,
}

/// Splits a raw H.264 Annex B byte stream (`idb video-stream`) into access units.
///
/// A NAL ends where the next start code begins. A new unit starts at an access unit delimiter, an
/// SPS, a PPS, an SEI or the first slice of a picture, when the current unit has a slice. The last
/// NAL of a pipe write is only complete when more bytes come, so the I/O calls [`AnnexB::flush`]
/// when the pipe is quiet for a short time.
#[derive(Debug, Clone, Default)]
pub struct AnnexB {
    buf: Vec<u8>,
    /// NALs of the unit being built (without start codes).
    nals: Vec<Vec<u8>>,
    sps: Option<Vec<u8>>,
    pps: Option<Vec<u8>>,
    /// Bytes before the first start code are skipped.
    synced: bool,
}

impl AnnexB {
    /// Adds bytes and returns the complete units.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<Unit> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        if !self.synced {
            match find_start(&self.buf, 0) {
                Some((i, _)) => {
                    self.buf.drain(..i);
                    self.synced = true;
                }
                None => {
                    // Keep the last 3 bytes: a start code can span two writes.
                    let keep = self.buf.len().saturating_sub(3);
                    self.buf.drain(..keep);
                    return out;
                }
            }
        }
        while let Some((s0, l0)) = find_start(&self.buf, 0) {
            let Some((s1, _)) = find_start(&self.buf, s0 + l0) else { break };
            let nal = self.buf[s0 + l0..s1].to_vec();
            self.buf.drain(..s1);
            self.push_nal(nal, &mut out);
        }
        out
    }

    /// Ends the pending NAL and the unit, when the pipe is quiet. Returns the complete units.
    pub fn flush(&mut self) -> Vec<Unit> {
        let mut out = Vec::new();
        if let Some((s0, l0)) = find_start(&self.buf, 0) {
            let nal = self.buf[s0 + l0..].to_vec();
            self.buf.clear();
            if !nal.is_empty() {
                self.push_nal(nal, &mut out);
            }
        }
        if let Some(u) = self.take_unit() {
            out.push(u);
        }
        // The next write must start with a start code.
        self.synced = false;
        out
    }

    fn push_nal(&mut self, nal: Vec<u8>, out: &mut Vec<Unit>) {
        let t = nal_type(&nal);
        let has_slice = self.nals.iter().any(|n| matches!(nal_type(n), 1 | 5));
        if has_slice && (matches!(t, 6..=9) || first_slice(&nal)) {
            if let Some(u) = self.take_unit() {
                out.push(u);
            }
        }
        match t {
            7 => self.sps = Some(nal.clone()),
            8 => self.pps = Some(nal.clone()),
            _ => {}
        }
        self.nals.push(nal);
    }

    fn take_unit(&mut self) -> Option<Unit> {
        let nals = std::mem::take(&mut self.nals);
        if !nals.iter().any(|n| matches!(nal_type(n), 1 | 5)) {
            // No picture yet: keep the parameter sets for the next unit.
            self.nals = nals.into_iter().filter(|n| matches!(nal_type(n), 7 | 8)).collect();
            return None;
        }
        let key = nals.iter().any(|n| nal_type(n) == 5);
        let mut data = Vec::new();
        let mut put = |n: &[u8]| {
            data.extend_from_slice(&[0, 0, 0, 1]);
            data.extend_from_slice(n);
        };
        if key {
            // A key frame always carries the parameter sets, so a new viewer can start there.
            let has = |t: u8| nals.iter().any(|n| nal_type(n) == t);
            if !has(7) {
                if let Some(s) = &self.sps {
                    put(s);
                }
            }
            if !has(8) {
                if let Some(p) = &self.pps {
                    put(p);
                }
            }
        }
        for n in nals.iter().filter(|n| nal_type(n) != 9) {
            put(n);
        }
        Some(Unit { key, data })
    }
}

/// The width and height of a PNG from its IHDR chunk.
pub fn png_size(b: &[u8]) -> Option<(u32, u32)> {
    if b.len() < 24 || &b[..8] != b"\x89PNG\r\n\x1a\n" || &b[12..16] != b"IHDR" {
        return None;
    }
    let w = u32::from_be_bytes(b[16..20].try_into().ok()?);
    let h = u32::from_be_bytes(b[20..24].try_into().ok()?);
    (w > 0 && h > 0).then_some((w, h))
}

/// The frames that a new viewer needs: the last key frame and the frames after it.
#[derive(Debug, Clone, Default)]
pub struct FrameCache {
    frames: VecDeque<Frame>,
    bytes: usize,
}

impl FrameCache {
    /// Adds a frame. A key frame starts the cache again. Above the limits the cache empties and
    /// waits for the next key frame.
    pub fn push(&mut self, f: Frame) {
        if f.key {
            self.frames.clear();
            self.bytes = 0;
        } else if self.frames.is_empty() {
            return;
        }
        self.bytes += f.msg.len();
        self.frames.push_back(f);
        if self.frames.len() > CACHE_UNITS || self.bytes > CACHE_BYTES {
            self.clear();
        }
    }

    pub fn clear(&mut self) {
        self.frames.clear();
        self.bytes = 0;
    }

    /// The cached frames, oldest first.
    pub fn snapshot(&self) -> Vec<Frame> {
        self.frames.iter().cloned().collect()
    }

    pub fn len(&self) -> usize {
        self.frames.len()
    }

    pub fn is_empty(&self) -> bool {
        self.frames.is_empty()
    }
}

/// What a viewer does with a live frame.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Deliver {
    Send,
    Skip,
}

/// The frame filter of one viewer: frames already sent from the cache are skipped, and after a
/// gap (a lag) the viewer waits for the next key frame. Pure.
#[derive(Debug, Clone)]
pub struct ViewerGate {
    last_seq: Option<u64>,
    need_key: bool,
}

impl ViewerGate {
    /// `last_seq`: the last frame sent from the cache. A viewer with no cache waits for a key frame.
    pub fn new(last_seq: Option<u64>) -> ViewerGate {
        ViewerGate { last_seq, need_key: last_seq.is_none() }
    }

    /// Frames were lost: wait for the next key frame.
    pub fn lagged(&mut self) {
        self.need_key = true;
    }

    /// True while the viewer waits for a key frame.
    pub fn waits_for_key(&self) -> bool {
        self.need_key
    }

    pub fn offer(&mut self, f: &Frame) -> Deliver {
        if self.last_seq.is_some_and(|l| f.seq <= l) {
            return Deliver::Skip;
        }
        if self.need_key && !f.key {
            return Deliver::Skip;
        }
        self.need_key = false;
        self.last_seq = Some(f.seq);
        Deliver::Send
    }
}
