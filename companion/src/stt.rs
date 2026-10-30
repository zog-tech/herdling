//! `stt.make`: text for a voice recording, made by the host's `stt_command`
//! (for example a Parakeet or Whisper script).
//!
//! stdin gets the audio bytes (WAV from the app). stdout is the text.

use std::time::Duration;

use base64::Engine;

use crate::types::RpcError;

/// Most audio bytes accepted. Ten minutes of 16 kHz mono PCM16 is about 19 MiB.
pub const MAX_AUDIO: usize = 25 << 20;
/// Most text bytes read from stdout.
pub const MAX_OUTPUT: usize = 64 * 1024;
/// Bound for one STT command. The app waits a little longer.
pub const TIMEOUT: Duration = Duration::from_secs(120);

fn err(code: &str, message: impl Into<String>) -> RpcError {
    RpcError { code: code.into(), message: message.into() }
}

/// Decodes `audio_b64`. Audio over `MAX_AUDIO` gives `too_large`.
pub fn decode(audio_b64: &str) -> Result<Vec<u8>, RpcError> {
    let too_large = || err("too_large", format!("stt.make: the audio is larger than {MAX_AUDIO} bytes"));
    // Check the size before the decode, so a huge request does not allocate twice.
    if audio_b64.len() / 4 * 3 > MAX_AUDIO + 3 {
        return Err(too_large());
    }
    let audio = base64::engine::general_purpose::STANDARD
        .decode(audio_b64.trim())
        .map_err(|e| err("bad_request", format!("stt.make: audio_b64 is not base64: {e}")))?;
    if audio.len() > MAX_AUDIO {
        return Err(too_large());
    }
    if audio.is_empty() {
        return Err(err("bad_request", "stt.make: the audio is empty"));
    }
    Ok(audio)
}

/// Runs `argv` on `audio` and returns the trimmed text.
pub async fn make(argv: &[String], audio: Vec<u8>, timeout: Duration) -> Result<String, RpcError> {
    let out = crate::hostcmd::run(argv, audio, timeout, MAX_OUTPUT).await?;
    Ok(String::from_utf8_lossy(&out).trim().to_string())
}
