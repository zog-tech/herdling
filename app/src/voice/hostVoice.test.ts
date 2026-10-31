import type { TtsAudio } from "@herdling/protocol";

import { speakWithHost, type Clip, type HostVoiceDeps } from "./hostVoice";

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void; reject: (e: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const audio = (text: string): TtsAudio => ({ audio_b64: btoa(text), mime: "audio/wav" });
const tick = () => new Promise((r) => setTimeout(r, 0));

/** A fake host and player. Each request and each playback waits until the test lets it go. */
function fake() {
  const log: string[] = [];
  const requests: Record<string, Deferred<TtsAudio>> = {};
  const plays: Record<string, Deferred<void>> = {};
  const files = new Set<string>();
  const deps: HostVoiceDeps = {
    tts: (text) => {
      log.push(`tts ${text}`);
      requests[text] = deferred();
      return requests[text].promise;
    },
    writeClip: async (a) => {
      const uri = `file:///cache/${atob(a.audio_b64)}.wav`;
      files.add(uri);
      return { uri };
    },
    deleteClip: (c: Clip) => {
      log.push(`delete ${c.uri.slice(14, -4)}`);
      files.delete(c.uri);
    },
    play: (c) => {
      const name = c.uri.slice(14, -4);
      log.push(`play ${name}`);
      plays[name] = deferred();
      return plays[name].promise;
    },
  };
  return { deps, log, requests, plays, files };
}

describe("speakWithHost", () => {
  it("plays in order and keeps up to AHEAD requests in flight", async () => {
    const f = fake();
    const done = speakWithHost(["a", "b", "c", "d", "e"], f.deps, () => false);
    await tick();
    // The first AHEAD sentences are asked for at once.
    expect(f.log).toEqual(["tts a", "tts b", "tts c"]);
    f.requests.b.resolve(audio("b"));
    await tick();
    expect(f.log).not.toContain("play b"); // b waits for a.
    f.requests.a.resolve(audio("a"));
    await tick();
    // a plays as soon as it arrives, and d is asked for at once.
    expect(f.log).toEqual(["tts a", "tts b", "tts c", "play a", "tts d"]);
    f.plays.a.resolve();
    await tick();
    expect(f.log.slice(5)).toEqual(["delete a", "play b", "tts e"]);
    f.requests.c.resolve(audio("c"));
    f.requests.d.resolve(audio("d"));
    f.requests.e.resolve(audio("e"));
    for (const n of ["b", "c", "d", "e"]) {
      f.plays[n].resolve();
      await tick();
    }
    await expect(done).resolves.toEqual({ status: "done" });
    expect(f.log.filter((l) => l.startsWith("play"))).toEqual(["play a", "play b", "play c", "play d", "play e"]);
    expect(f.files.size).toBe(0);
  });

  it("a failed request gives the index of the first sentence not spoken", async () => {
    const f = fake();
    const done = speakWithHost(["a", "b", "c"], f.deps, () => false);
    await tick();
    f.requests.a.resolve(audio("a"));
    await tick();
    f.requests.b.reject(Object.assign(new Error("no command"), { code: "no_command" }));
    f.plays.a.resolve();
    await expect(done).resolves.toEqual({ status: "failed", at: 1 });
    expect(f.files.size).toBe(0);
  });

  it("a failed first request fails at 0, and a failed playback fails at its sentence", async () => {
    const f = fake();
    const first = speakWithHost(["a", "b"], f.deps, () => false);
    await tick();
    f.requests.a.reject(new Error("command_failed"));
    await expect(first).resolves.toEqual({ status: "failed", at: 0 });

    const g = fake();
    const second = speakWithHost(["a", "b"], g.deps, () => false);
    await tick();
    g.requests.a.resolve(audio("a"));
    await tick();
    g.plays.a.reject(new Error("cannot decode"));
    await expect(second).resolves.toEqual({ status: "failed", at: 0 });
    g.requests.b.resolve(audio("b"));
    await tick();
    expect(g.files.size).toBe(0); // The prefetched clip is deleted when it arrives.
  });

  it("cancel stops the queue and deletes every clip", async () => {
    const f = fake();
    let cancelled = false;
    const done = speakWithHost(["a", "b", "c"], f.deps, () => cancelled);
    await tick();
    f.requests.a.resolve(audio("a"));
    await tick();
    f.requests.b.resolve(audio("b"));
    await tick();
    // The stop: the caller sets the flag and stops the player, which ends the clip.
    cancelled = true;
    f.plays.a.resolve();
    await expect(done).resolves.toEqual({ status: "cancelled" });
    await tick();
    expect(f.log).not.toContain("play b");
    f.requests.c.resolve(audio("c"));
    await tick();
    expect(f.files.size).toBe(0); // Clips that arrive after the stop are deleted too.
  });

  it("cancel while the first clip loads plays nothing", async () => {
    const f = fake();
    let cancelled = false;
    const done = speakWithHost(["a"], f.deps, () => cancelled);
    await tick();
    cancelled = true;
    f.requests.a.resolve(audio("a"));
    await expect(done).resolves.toEqual({ status: "cancelled" });
    expect(f.log).not.toContain("play a");
    expect(f.files.size).toBe(0);
  });
});
