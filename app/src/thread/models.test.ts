import { canSwitchModel, currentModelChoice, hasModelItem, MODELS, modelPrompt } from "./models";

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

test("the_current_model_maps_to_its_family_pick", () => {
  expect(currentModelChoice("claude-opus-5-5")).toBe("opus");
  expect(currentModelChoice("claude-3-5-sonnet-20241022")).toBe("sonnet");
  expect(currentModelChoice("Haiku 4.5")).toBe("haiku");
  expect(currentModelChoice("claude-opus-5-5[1m]")).toBe("opus");
  expect(currentModelChoice("gpt-5.5")).toBeUndefined();
  expect(currentModelChoice(undefined)).toBeUndefined();
});
