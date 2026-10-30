import { appendDictation, engineOrder, formatElapsed, hostTranscriber, TranscribeError, transcribeRecording } from "./transcribe";
import { inputEngine } from "./settings";

jest.mock("@/secureStorage", () => ({
  secureJSONStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

const rec = { uri: "file:///r.wav", durationMs: 1000 };

test("engine_order_puts_the_choice_first_and_apple_last_unless_chosen", () => {
  expect(engineOrder("parakeet")).toEqual(["parakeet", "host", "apple"]);
  expect(engineOrder("host")).toEqual(["host", "parakeet", "apple"]);
  expect(engineOrder("apple")).toEqual(["apple", "parakeet", "host"]);
});

test("default_engine_is_parakeet_when_installed_else_apple", () => {
  expect(inputEngine(undefined, true)).toBe("parakeet");
  expect(inputEngine(undefined, false)).toBe("apple");
  expect(inputEngine("parakeet", false)).toBe("apple");
  expect(inputEngine("host", false)).toBe("host");
  expect(inputEngine("apple", true)).toBe("apple");
});

test("parakeet_failure_falls_to_host", async () => {
  const parakeet = jest.fn().mockRejectedValue(new Error("model gone"));
  const host = jest.fn().mockResolvedValue("  from host ");
  const r = await transcribeRecording(rec, "parakeet", { parakeet, host });
  expect(r).toMatchObject({ text: "from host", engine: "host" });
  expect(parakeet).toHaveBeenCalledWith("file:///r.wav");
});

test("missing_engines_are_skipped_and_live_text_is_the_last_resort", async () => {
  const host = jest.fn().mockRejectedValue(new Error("no_command"));
  const r = await transcribeRecording({ ...rec, text: "live words" }, "parakeet", { host });
  expect(r).toMatchObject({ text: "live words", engine: "apple" });
});

test("apple_uses_the_live_text_without_reading_the_file", async () => {
  const parakeet = jest.fn();
  const r = await transcribeRecording({ ...rec, text: "" }, "apple", { parakeet });
  expect(r).toMatchObject({ text: "", engine: "apple" });
  expect(parakeet).not.toHaveBeenCalled();
});

test("apple_without_live_text_reads_the_file_with_parakeet", async () => {
  const r = await transcribeRecording(rec, "apple", { parakeet: async () => "p" });
  expect(r).toMatchObject({ text: "p", engine: "parakeet" });
});

test("every_engine_failing_gives_a_transcribe_error_with_each_cause", async () => {
  const p = transcribeRecording(rec, "host", {
    host: () => Promise.reject(new Error("timeout")),
    parakeet: () => Promise.reject(new Error("failed")),
  });
  await expect(p).rejects.toBeInstanceOf(TranscribeError);
  await expect(p).rejects.toThrow("Host: timeout; Parakeet: failed");
  await expect(transcribeRecording(rec, "host", {})).rejects.toThrow("No voice engine is available");
});

test("host_transcriber_sends_the_wav_as_base64", async () => {
  const call = jest.fn().mockResolvedValue({ text: "hi" });
  const t = hostTranscriber(call as any, async () => "UklGRg==");
  expect(await t("file:///r.wav")).toBe("hi");
  expect(call).toHaveBeenCalledWith("stt.make", { audio_b64: "UklGRg==", mime: "audio/wav" }, 130_000);
});

test("dictation_is_appended_with_one_space", () => {
  expect(appendDictation("", " hello ")).toBe("hello");
  expect(appendDictation("fix the bug", "in parser")).toBe("fix the bug in parser");
  expect(appendDictation("line one\n", "two")).toBe("line one\ntwo");
  expect(appendDictation("keep", "  ")).toBe("keep");
});

test("elapsed_is_minutes_and_seconds", () => {
  expect(formatElapsed(0)).toBe("0:00");
  expect(formatElapsed(7_900)).toBe("0:07");
  expect(formatElapsed(65_000)).toBe("1:05");
  expect(formatElapsed(600_000)).toBe("10:00");
});
