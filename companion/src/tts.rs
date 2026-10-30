//! `tts.make`: speech audio for a piece of text, made by the host's `tts_command`
//! (for example a Kokoro or Piper script).
//!
//! stdin gets the text. stdout is the audio: WAV, MP3 or Ogg, told apart by its first bytes.

use std::time::Duration;

use base64::Engine;

use crate::types::{RpcError, TtsAudio};

/// Longer input keeps its start. The app sends one sentence at a time.
pub const MAX_INPUT_CHARS: usize = 8_000;
/// Most audio bytes read from stdout.
pub const MAX_OUTPUT: usize = 10 * 1024 * 1024;
/// Bound for one TTS command. The app waits a little longer.
pub const TIMEOUT: Duration = Duration::from_secs(30);

/// The first `MAX_INPUT_CHARS` characters of `text`.
pub fn clip(text: &str) -> &str {
    text.char_indices().nth(MAX_INPUT_CHARS).map_or(text, |(i, _)| &text[..i])
}

/// The audio mime type from the magic bytes, if known.
pub fn mime(audio: &[u8]) -> Option<&'static str> {
    match audio {
        [b'R', b'I', b'F', b'F', _, _, _, _, b'W', b'A', b'V', b'E', ..] => Some("audio/wav"),
        [b'I', b'D', b'3', ..] | [0xFF, 0xFB | 0xF3 | 0xF2, ..] => Some("audio/mpeg"),
        [b'O', b'g', b'g', b'S', ..] => Some("audio/ogg"),
        _ => None,
    }
}

/// Runs `argv` on `text` and returns the audio as base64 with its mime type.
pub async fn make(argv: &[String], text: &str, timeout: Duration) -> Result<TtsAudio, RpcError> {
    let audio = crate::hostcmd::run(argv, clip(text).as_bytes().to_vec(), timeout, MAX_OUTPUT).await?;
    let mime = mime(&audio).ok_or_else(|| RpcError { code: "command_failed".into(), message: "unknown audio format".into() })?;
    Ok(TtsAudio { audio_b64: base64::engine::general_purpose::STANDARD.encode(&audio), mime: mime.into() })
}
