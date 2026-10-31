import type { TtsAudio } from "@zogssh/protocol";

/** One audio clip on disk. */
export type Clip = { uri: string };

export type HostVoiceDeps = {
  /** Asks the host's `tts.make` for one sentence. Rejects on any error. */
  tts(text: string): Promise<TtsAudio>;
  /** Writes the audio to a cache file. */
  writeClip(audio: TtsAudio): Promise<Clip>;
  /** Removes a cache file. Never throws. */
  deleteClip(clip: Clip): void;
  /** Plays a clip. Resolves when it ends or `stop` is called; rejects when playback fails. */
  play(clip: Clip): Promise<void>;
};

export type HostVoiceResult = { status: "done" } | { status: "cancelled" } | { status: "failed"; at: number };

/** Sentences asked for ahead of the one that plays, so a slow request never leaves a gap. */
export const AHEAD = 3;

/**
 * Speaks `sentences` with the host voice. Asks for the first sentences at once, plays each clip as
 * soon as it arrives, and keeps up to `AHEAD` requests in flight past the one that plays.
 * Clips play in order and their files are deleted after.
 * `cancelled()` is checked between steps; the caller stops the player to end the current clip.
 * A failed request or playback gives `failed` with the index of the first sentence not spoken.
 */
export async function speakWithHost(
  sentences: string[],
  deps: HostVoiceDeps,
  cancelled: () => boolean,
): Promise<HostVoiceResult> {
  const fetchClip = (i: number) => deps.tts(sentences[i]).then((a) => deps.writeClip(a));
  // A prefetch that fails while an earlier clip plays is handled when its turn comes.
  const settle = (p: Promise<Clip>) => p.then((clip) => ({ clip }), () => ({ clip: undefined }));
  const queue: Promise<{ clip: Clip | undefined }>[] = [];
  let asked = 0;
  const fill = (max: number) => {
    while (queue.length < max && asked < sentences.length) queue.push(settle(fetchClip(asked++)));
  };
  fill(AHEAD);
  for (let i = 0; i < sentences.length; i++) {
    const { clip } = await queue.shift()!;
    if (cancelled()) {
      if (clip) deps.deleteClip(clip);
      return dropPending(queue, deps, { status: "cancelled" });
    }
    if (!clip) return dropPending(queue, deps, { status: "failed", at: i });
    try {
      const playing = deps.play(clip);
      fill(AHEAD);
      await playing;
    } catch {
      return dropPending(queue, deps, cancelled() ? { status: "cancelled" } : { status: "failed", at: i });
    } finally {
      deps.deleteClip(clip);
    }
    if (cancelled()) return dropPending(queue, deps, { status: "cancelled" });
  }
  return { status: "done" };
}

/** Deletes the prefetched clips, when they arrive, and returns `result`. */
function dropPending(
  queue: Promise<{ clip: Clip | undefined }>[],
  deps: HostVoiceDeps,
  result: HostVoiceResult,
): HostVoiceResult {
  for (const p of queue) void p.then(({ clip }) => clip && deps.deleteClip(clip));
  return result;
}
