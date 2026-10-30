# Open-source TTS: community sentiment, 2026-10-30

Use case: read an AI coding agent's replies aloud on headphones. Generate on a home server (an Apple Silicon Mac, or Ubuntu with no big GPU). Near real-time. English first.

## Method and limits (read first)

- Reddit was NOT reachable. WebFetch blocked `www.reddit.com` and `old.reddit.com`. WebSearch refused the `reddit.com` domain. No Reddit thread was read. Reddit sentiment is **unverified**.
- X/Twitter: WebSearch surfaced no usable X posts.
- Community evidence comes from one large Hacker News thread (515 points, Kokoro CPU article, read in full through the HN Algolia API) and from blog benchmarks. Blogs are partly vendor-adjacent. Treat the speed numbers as rough.
- TTS Arena (HF space `TTS-AGI/TTS-Arena-V2`, last updated 2026-10-24) exists, but the leaderboard page did not render through fetch. No Arena ranks are used here (unverified).
- Licenses and download counts come from the Hugging Face API tags on 2026-10-30. The tag is not the same as the full license text. Check each card before you ship. The Pocket TTS card is gated, so its license is from the API tag only.
- Hugging Face downloads (all-time, from the API) are a rough popularity signal, not a quality signal.

## Ranked table

Rank is for THIS use case (English, CPU or Apple Silicon, near real-time, no cloning needed). Rank is not general voice quality.

| # | Model | License (HF tag) | Quality sentiment | Speed on CPU / Apple Silicon | Setup | Common complaints |
|---|---|---|---|---|---|---|
| 1 | Kokoro-82M | Apache-2.0 | Most praised small model. "Most natural sounding and small." Weak on the last ~2% of nuance. | Real time on CPU. One article: short paragraph in 4.5 s on M2 Pro CPU, 1.5 s on Ryzen 7 8745HS. MLX and CoreML ports exist. A vendor blog claims RTF about 0.08 on M5 Max (unverified). | Easy. Kokoro-FastAPI container with an OpenAI-compatible endpoint, `pip install kokoro`, mlx-audio on Mac. | Single words and very short text sound wrong. Homographs can get the wrong pronunciation (IPA overrides help). No voice cloning. Male voices rated worse than female. Docker image is about 5 GB in one guide. |
| 2 | Kyutai Pocket TTS (about 100M) | CC-BY-4.0 (API tag; card gated, unverified) | Several HN commenters rate it better than Kokoro, mostly with a good cloned voice. Easy voice cloning from a small sample. | Built for CPU. One benchmark: about 6x real time on Apple M4 in WASM (browser). One HN user says PyTorch beats the ONNX build on CPU. | Easy to moderate. Python package, ONNX port exists. | Newer, less battle-tested for long text. CC-BY needs attribution. I found no head-to-head with Kokoro on text from coding agents. |
| 3 | Piper | MIT (piper-voices tag; the engine repo is GPL, and each voice has its own license, verify) | Clear but more robotic than Kokoro. One user runs it for Claude Code notifications and says it "works perfectly". | Fastest option. Real time even on a Raspberry Pi 4 (one source). | Very easy. Single binary plus ONNX voices. | Robotic voices. Engine repo licensing changed (GPL). Verify before you bundle it. |
| 4 | Chatterbox / Chatterbox-Turbo (350M) | MIT | Good expressive quality and cloning. Often named the best open "cloning" model. | Slower on CPU. An MLX fork of the original model shows RTF about 0.65-0.74 on M4 (below real time). Vendor claims up to 6x for Turbo on GPU (unverified for Mac). | Moderate. Needs PyTorch or an MLX fork. | Heavy for a CPU box. No independent Mac numbers for Turbo. |
| 5 | Qwen3-TTS (1.7B) | Apache-2.0 | High HF interest (2.2k likes). No community quotes found. | Too big for CPU real time (unverified). | Moderate. | Size. Not tested here. |
| 6 | Orpheus-3B | Apache-2.0 (tag; base is Llama 3.2, check the Llama terms) | Praised for emotion tags in guides. | A 3B LLM-style model. Needs a GPU for real time. No Mac numbers found. | Moderate to hard. | Heavy. Needs a GPU. |
| 7 | F5-TTS | CC-BY-NC-4.0 (non-commercial) | One HN user names it for ElevenLabs-like quality. | GPU-oriented. | Moderate. | Non-commercial license. Slower. |
| 8 | Sesame CSM-1B | Apache-2.0 | Conversational feel. No fresh sentiment found. | Needs a GPU for real time (unverified). | Moderate. | Not built for plain read-aloud. |
| 9 | Dia-1.6B | Apache-2.0 | Dialogue focus. No fresh sentiment found. | GPU (unverified). | Moderate. | Dialogue model, not a reader. |
| 10 | XTTS-v2 | "other" (Coqui Public Model License, non-commercial) | Older. Replaced in most threads by newer models. | Slow on CPU. | Moderate. | Restrictive license. Coqui is defunct. Last model update 2023. |
| 11 | StyleTTS2, Parler-TTS | StyleTTS2: no tag (verify). Parler: Apache-2.0 | No 2026 sentiment found. Kokoro is built on StyleTTS2. | Not benchmarked here. | Moderate. | Superseded by Kokoro for this use case. |

Other names that appeared (not ranked, little evidence): Supertonic 3 (praised on HN for mixed-language text), Kitten TTS 2 (HF license "other", now a 1.7B model, so not tiny), VoxCPM2 (Apache-2.0, 1.0M downloads), OmniVoice (no license tag, 2.6M downloads), Fish Audio S2 Pro (commercial use needs a paid license), Higgs Audio V2 (about 5.8B, too big).

## Representative quotes

1. "kokoro is decent but pocket-tts is much better especially when you rip a good voice." HN commenter, [Kokoro CPU thread](https://news.ycombinator.com/item?id=48821576).
2. "I use kokoro with home assistant and its great. I find its the most natural sounding and small too." HN commenter, same thread.
3. "On macOS I've been using piper ... to announce claude code notifications and it works perfectly!" HN commenter, same thread. This is the closest match to our use case.
4. "Try having it say simply 'six' and it almost always says something like 'ah-six-ah'." HN commenter, quoted from the same thread (single-word weakness).
5. "kokoro is surprisingly great at nuance but it's tough to improve that last ~2% or so." HN commenter, same thread.
6. "Both Text-to-Speech and Speech-to-Text now have local models that are good enough to get the job done. Kokoro for TTS ..." HN commenter, same thread.

Supporting article: [Local, CPU-Friendly, High-Quality TTS with Kokoro](https://ariya.io/2026/03/local-cpu-friendly-high-quality-tts-text-to-speech-with-kokoro) (CPU timings above). Mac port: [Kokoro CoreML on HF](https://huggingface.co/mattmireles/kokoro-coreml).

## Consensus

For a CPU-only or Apple Silicon box, the community picks Kokoro-82M. It has the best quality for its size, an Apache-2.0 license, a ready OpenAI-compatible server, and Mac ports. Its known faults are short utterances and homographs. Both are easy to avoid when the input is full sentences from an agent. Kyutai Pocket TTS is the rising rival. Some users rate it higher, mainly when they clone a voice. Piper stays the lowest-power fallback, with a more robotic voice. The big models (Chatterbox, Orpheus, Qwen3-TTS, F5, Sesame, Dia) win on expressiveness or cloning, but they need a GPU or run below real time on CPU. They are a poor fit for this use case. Caveat: this consensus rests on one HN thread plus blogs. Reddit was not checked.

## Recommendation

- **Default: Kokoro-82M.** On an Apple Silicon Mac, use mlx-audio or Kokoro-CoreML. On Ubuntu CPU, use Kokoro-FastAPI. Split the agent reply into sentences. Strip code blocks and URLs before TTS. Stream sentence by sentence to hide latency. Add a pronunciation override map for identifiers.
- **Low-power alternative: Piper** (Raspberry Pi class or a very weak CPU). Check the engine and voice licenses first.
- **Watch: Pocket TTS.** Run a 10-minute A/B against Kokoro on real agent replies before you decide. It may win if you want a custom voice.
- Before you commit, do a local benchmark on the real hardware. Measure RTF and time to first audio on 3 typical replies. No source here gave a trustworthy number for a small Apple Silicon Mac.

## Unverified items

Reddit sentiment, X posts, TTS Arena ranks, Pocket TTS card text, Piper engine license status, Orpheus license terms, all vendor RTF claims, StyleTTS2 and Parler sentiment.
