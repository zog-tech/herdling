import type { TtsAudio } from "@zogssh/protocol";
import { createAudioPlayer, type AudioPlayer, type AudioStatus } from "expo-audio";
import { File, Paths } from "expo-file-system";

import type { Clip, HostVoiceDeps } from "./hostVoice";

const EXT: Record<TtsAudio["mime"], string> = { "audio/wav": "wav", "audio/mpeg": "mp3", "audio/ogg": "ogg" };
/** A clip that does not load in this time counts as failed. */
const LOAD_TIMEOUT_MS = 10_000;
/** Slack after the clip's own length before a missing end event counts as the end. */
const END_SLACK_MS = 3_000;

let player: AudioPlayer | undefined;
let current: { token: number; end: (error?: Error) => void } | undefined;
let tokens = 0;
let seq = 0;

/**
 * One player for the app's lifetime. `keepAudioSessionActive` keeps expo-audio from deactivating
 * the shared audio session after a clip: the voice module's `setSpeechAudio`/`releaseAudio` own the
 * session, so a deactivation can never land on a dictation that just started.
 */
function getPlayer(): AudioPlayer {
  if (!player) {
    player = createAudioPlayer(null, { keepAudioSessionActive: true, updateInterval: 250 });
    player.addListener("playbackStatusUpdate", (s: AudioStatus & { error?: string }) => {
      if (!current) return;
      if (s.error) current.end(new Error(s.error));
      else if (s.didJustFinish) current.end();
      else if (s.isLoaded && s.duration > 0) watch(current.token, (s.duration / (s.playbackRate || 1)) * 1000 + END_SLACK_MS);
    });
  }
  return player;
}

let watchdog: ReturnType<typeof setTimeout> | undefined;
let watchedFor = -1;

/** Ends the current clip if it is still `token` after `ms`. A load timeout fails; a late end does not. */
function watch(token: number, ms: number, fail = false) {
  if (!fail && watchedFor === token) return; // The length timer is set once per clip.
  clearTimeout(watchdog);
  watchedFor = fail ? -1 : token;
  watchdog = setTimeout(() => {
    if (current?.token === token) current.end(fail ? new Error("clip did not load") : undefined);
  }, ms);
}

/** Stops the host voice clip now. The pending `play` resolves. */
export function stopHostAudio(): void {
  if (!current) return;
  player?.pause();
  current.end();
}

export function hostAudio(rate: number): Omit<HostVoiceDeps, "tts"> {
  return {
    async writeClip(audio) {
      const file = new File(Paths.cache, `zogssh-tts-${Date.now()}-${seq++}.${EXT[audio.mime] ?? "audio"}`);
      await file.write(audio.audio_b64, { encoding: "base64" });
      return { uri: file.uri };
    },
    deleteClip(clip: Clip) {
      try {
        const file = new File(clip.uri);
        if (file.exists) file.delete();
      } catch {
        // Cache files are cleared by the system later.
      }
    },
    play(clip) {
      return new Promise<void>((resolve, reject) => {
        current?.end();
        const token = ++tokens;
        current = {
          token,
          end: (error) => {
            if (current?.token !== token) return;
            current = undefined;
            clearTimeout(watchdog);
            if (error) reject(error);
            else resolve();
          },
        };
        const p = getPlayer();
        p.replace({ uri: clip.uri });
        p.setPlaybackRate(Math.min(2, Math.max(0.5, rate)));
        watch(token, LOAD_TIMEOUT_MS, true);
        p.play();
      });
    },
  };
}
