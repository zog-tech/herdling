import { MAX_CHARS, modelLabel } from "./modelLabel";

test("claude_ids_get_the_family_and_version", () => {
  expect(modelLabel("claude-opus-5-5")).toBe("Opus 5.5");
  expect(modelLabel("claude-sonnet-5-5")).toBe("Sonnet 5.5");
  expect(modelLabel("claude-haiku-5-5")).toBe("Haiku 5.5");
  expect(modelLabel("claude-fable-5-2")).toBe("Fable 5.2");
});

test("dated_and_older_claude_ids_drop_the_date", () => {
  expect(modelLabel("claude-opus-4-5-20251101")).toBe("Opus 4.5");
  expect(modelLabel("claude-opus-4-20250514")).toBe("Opus 4");
  expect(modelLabel("claude-3-5-sonnet-20241022")).toBe("Sonnet 3.5");
});

test("a_1m_context_id_gets_a_suffix", () => {
  expect(modelLabel("claude-opus-5-5[1m]")).toBe("Opus 5.5 · 1M");
  expect(modelLabel("claude-sonnet-5-5[1M]")).toBe("Sonnet 5.5 · 1M");
});

test("aliases_and_switch_names_stay_short", () => {
  expect(modelLabel("opus")).toBe("Opus");
  expect(modelLabel("Opus 5.5")).toBe("Opus 5.5");
});

test("other_agents_ids_show_as_they_are", () => {
  expect(modelLabel("gpt-5.5")).toBe("gpt-5.5");
  expect(modelLabel("gemini-3-pro")).toBe("gemini-3-pro");
  expect(modelLabel("openai/gpt-5.5")).toBe("gpt-5.5");
  expect(modelLabel("claude-unknown-thing")).toBe("claude-unknown-thing");
});

test("long_ids_are_cut", () => {
  const label = modelLabel("muse-spark-1.3-contributor-free-preview")!;
  expect(label.length).toBe(MAX_CHARS);
  expect(label.endsWith("…")).toBe(true);
});

test("no_value_gives_no_label", () => {
  expect(modelLabel(undefined)).toBeUndefined();
  expect(modelLabel(null)).toBeUndefined();
  expect(modelLabel("  ")).toBeUndefined();
  expect(modelLabel("[1m]")).toBeUndefined();
});
