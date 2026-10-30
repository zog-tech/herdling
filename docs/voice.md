# Voice: summaries and host speech

Zogssh ships no AI provider. Spoken replies use the iPhone by default. The host can add two
optional commands in `~/.config/zogsshd/config.toml`:

- `summary_command`: makes a short summary of a reply for Summary mode.
- `tts_command`: makes speech audio when the app's voice engine is "Host voice command".

Any tool that reads stdin and writes stdout works. Each command is an argv array. The companion
runs it with no shell: the first item is the program, the other items are its arguments.

## Where the speech text comes from

1. The app turns the reply's markdown into plain speech text (code blocks, tables and links are
   replaced by short words).
2. In Full mode the app speaks that text.
3. In Summary mode the app tries, in order:
   1. the on-device model (Apple Intelligence, iOS 26 and later, when it is turned on),
   2. the host summary command (`summary.make`),
   3. the full text.

   A step that fails, times out or gives no text falls to the next step.

## Voice engine

Settings > Voice > Voice engine:

- **iPhone** (default): the device voices, with the voice and speed from Settings.
- **Host**: the app splits the speech text into sentences and calls `tts.make` for each one. It
  plays sentence 1 as soon as its audio arrives and asks for sentence 2 while sentence 1 plays.
  The speed setting applies to the host audio too.

When a `tts.make` call fails (no command, the command fails, a timeout, or no connection), the app
speaks the rest of that reply with the iPhone voice. It shows "Host voice command failed — using
iPhone voice" once per app run.

The same events stop both engines: the speaker toggle turned off, a new prompt, holding the mic
button, or leaving the session screen.

## Contracts

### `summary_command`

- stdin: one instructions line, a blank line, then the reply text. Text longer than 24 000
  characters keeps its end.
- stdout: the summary as plain text, at most 16 KiB. The companion trims it.
- Time limit: 20 s. The app waits 25 s.

### `tts_command`

- stdin: one sentence (or more) of plain text, at most 8 000 characters.
- stdout: audio bytes, at most 10 MiB: WAV, MP3 or Ogg. The companion finds the type from the
  first bytes. Use WAV or MP3: iOS may not play Ogg.
- Time limit: 30 s. The app waits 35 s.

### Errors

| Code | When |
|---|---|
| `no_command` | The command is not set, or is an empty array. |
| `command_failed` | The program does not start (the message names the program only), it exits with a non-zero code (the message has the code and at most 200 characters of stderr), its output is too large, or the audio type is unknown. |
| `timeout` | The command did not finish in time. The companion kills the command and every process it started. |
| `upstream_error` | The command wrote nothing. |

Error messages never contain the input text.

## Example config

These commands are examples. Adapt the paths, models and voices to your host.

The companion runs from an SSH forced command, so `PATH` is short. Use absolute paths, or a
wrapper script that sets `PATH`.

### Summary

```toml
# Claude Code in print mode.
summary_command = ["/home/sam/.local/bin/claude", "-p"]

# A local model with Ollama.
summary_command = ["/usr/local/bin/ollama", "run", "llama3.2"]

# The llm CLI.
summary_command = ["/home/sam/.local/bin/llm", "-m", "gpt-4o-mini"]
```

### TTS

Piper reads text on stdin and can write WAV to stdout:

```toml
tts_command = ["/home/sam/.local/bin/piper", "--model", "/path/en_US-lessac-medium.onnx", "--output_file", "-"]
```

Kokoro on Linux, with a Kokoro-FastAPI server (OpenAI-compatible endpoint) and a wrapper script
`/home/sam/bin/kokoro-tts`:

```sh
#!/bin/sh
# Reads text on stdin, writes WAV on stdout.
jq -Rs '{model: "kokoro", voice: "af_heart", response_format: "wav", input: .}' |
  curl -sf http://127.0.0.1:8880/v1/audio/speech -H 'Content-Type: application/json' --data-binary @-
```

```toml
tts_command = ["/home/sam/bin/kokoro-tts"]
```

Kokoro on macOS with mlx-audio, through a wrapper script. The mlx-audio flags change between
versions; check `python -m mlx_audio.tts.generate --help`.

```sh
#!/bin/sh
# Reads text on stdin, writes WAV on stdout.
dir=$(mktemp -d) || exit 1
trap 'rm -rf "$dir"' EXIT
/home/sam/.venvs/tts/bin/python -m mlx_audio.tts.generate \
  --model prince-canuma/Kokoro-82M --voice af_heart --audio_format wav \
  --file_prefix "$dir/out" --join_audio --text "$(cat)" >/dev/null 2>&1 || exit 1
cat "$dir"/out*.wav
```

For a comparison of open TTS models, see
[research/2026-10-30-open-tts-sentiment.md](research/2026-10-30-open-tts-sentiment.md).

## Upgrade note

Older companion configs can contain `anthropic_key`. The companion ignores it and drops it the
next time it writes the config. Set `summary_command` to keep host summaries.
