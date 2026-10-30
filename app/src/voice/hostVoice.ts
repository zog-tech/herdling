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

/**
 * Speaks `sentences` with the host voice. Asks for sentence 1, plays it as soon as it arrives,
 * and asks for sentence n+1 while n plays. Clips play in order and their files are deleted after.
 * `cancelled()` is checked between steps; the caller stops the player to end the current clip.
 * A failed request or playback gives `failed` with the index of the first sentence not spoken.
 */
export async function speakWithHost(
  sentences: string[],
  deps: HostVoiceDeps,
  cancelled: () => boolean,
): Promise<HostVoiceResult> {
  const fetchClip = (i: number) => deps.tts(sentences[i]).then((a) => deps.writeClip(a));
  // A prefetch that fails while the previous clip plays is handled when its turn comes.
  const settle = (p: Promise<Clip>) => p.then((clip) => ({ clip }), () => ({ clip: undefined }));
  let next = sentences.length ? settle(fetchClip(0)) : undefined;
  for (let i = 0; i < sentences.length; i++) {
    const { clip } = await next!;
    next = undefined;
    if (cancelled()) {
      if (clip) deps.deleteClip(clip);
      return { status: "cancelled" };
    }
    if (!clip) return { status: "failed", at: i };
    try {
      const playing = deps.play(clip);
      if (i + 1 < sentences.length) next = settle(fetchClip(i + 1));
      await playing;
    } catch {
      return dropPending(next, deps, cancelled() ? { status: "cancelled" } : { status: "failed", at: i });
    } finally {
      deps.deleteClip(clip);
    }
    if (cancelled()) return dropPending(next, deps, { status: "cancelled" });
  }
  return { status: "done" };
}

/** Deletes the prefetched clip, when it arrives, and returns `result`. */
function dropPending(
  next: Promise<{ clip: Clip | undefined }> | undefined,
  deps: HostVoiceDeps,
  result: HostVoiceResult,
): HostVoiceResult {
  void next?.then(({ clip }) => clip && deps.deleteClip(clip));
  return result;
}
