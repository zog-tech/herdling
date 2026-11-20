import { canSwitchModel, hasModelItem, MODELS, modelPrompt } from "./models";

test("the_list_is_default_opus_sonnet_haiku", () => {
  expect(MODELS.map((m) => m.label)).toEqual(["Default", "Opus", "Sonnet", "Haiku"]);
  expect(MODELS.map(modelPrompt)).toEqual(["/model default", "/model opus", "/model sonnet", "/model haiku"]);
});

test("only_claude_code_has_the_model_item", () => {
  expect(hasModelItem("claude")).toBe(true);
  expect(hasModelItem("codex")).toBe(false);
  expect(hasModelItem(null)).toBe(false);
});

test("a_pick_goes_only_while_the_agent_waits_for_input", () => {
  expect(canSwitchModel("idle")).toBe(true);
  expect(canSwitchModel("done")).toBe(true);
  expect(canSwitchModel("working")).toBe(false);
  expect(canSwitchModel("blocked")).toBe(false);
  expect(canSwitchModel("unknown")).toBe(false);
  expect(canSwitchModel(undefined)).toBe(false);
});
