import {
  addPrompt,
  changePrompt,
  cleanPrompt,
  DEFAULT_PROMPTS,
  deletePrompt,
  editPrompt,
  movePrompt,
  promptActions,
  promptChipLabel,
  removePrompt,
  reorderPrompt,
  restoreDefaultPrompts,
  SAVED_PROMPT_CAP,
  SAVED_PROMPT_MAX_CHARS,
  saveNewPrompt,
  useSavedPrompts,
} from "./savedPrompts";

jest.mock("@/secureStorage", () => {
  const { createJSONStorage } = jest.requireActual("zustand/middleware");
  const mem = new Map<string, string>();
  return {
    secureJSONStorage: () =>
      createJSONStorage(() => ({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      })),
  };
});

describe("the pure rules", () => {
  test("the defaults are short STE texts", () => {
    expect(DEFAULT_PROMPTS).toEqual(["Continue", "Yes, go ahead", "Run the tests", "Explain the change", "Commit and push"]);
  });

  test("clean trims, cuts and drops an empty text", () => {
    expect(cleanPrompt("  Run it \n")).toBe("Run it");
    expect(cleanPrompt(" \n ")).toBeNull();
    expect(cleanPrompt("x".repeat(SAVED_PROMPT_MAX_CHARS + 10))).toHaveLength(SAVED_PROMPT_MAX_CHARS);
  });

  test("add puts the text at the end, once, up to the cap", () => {
    expect(addPrompt(["a"], " b ")).toEqual(["a", "b"]);
    const list = ["a", "b"];
    expect(addPrompt(list, "a")).toBe(list);
    expect(addPrompt(list, "  ")).toBe(list);
    const full = Array.from({ length: SAVED_PROMPT_CAP }, (_, i) => `p${i}`);
    expect(addPrompt(full, "new")).toBe(full);
  });

  test("edit changes one prompt and keeps each text once", () => {
    expect(editPrompt(["a", "b"], 1, "c")).toEqual(["a", "c"]);
    const list = ["a", "b"];
    expect(editPrompt(list, 1, "a")).toBe(list);
    expect(editPrompt(list, 1, " ")).toBe(list);
    expect(editPrompt(list, 5, "z")).toBe(list);
    expect(editPrompt(list, 0, "a")).toBe(list);
  });

  test("remove drops the prompt at the index", () => {
    expect(removePrompt(["a", "b", "c"], 1)).toEqual(["a", "c"]);
    const list = ["a"];
    expect(removePrompt(list, 3)).toBe(list);
  });

  test("move puts a prompt at a new place", () => {
    expect(movePrompt(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(movePrompt(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
    const list = ["a", "b"];
    expect(movePrompt(list, 0, 0)).toBe(list);
    expect(movePrompt(list, 0, 2)).toBe(list);
    expect(movePrompt(list, -1, 0)).toBe(list);
  });

  test("the settings menu leaves out the moves that cannot happen", () => {
    expect(promptActions(0, 3)).toEqual(["edit", "down", "delete"]);
    expect(promptActions(1, 3)).toEqual(["edit", "up", "down", "delete"]);
    expect(promptActions(2, 3)).toEqual(["edit", "up", "delete"]);
    expect(promptActions(0, 1)).toEqual(["edit", "delete"]);
  });

  test("the chip label is one line", () => {
    expect(promptChipLabel("Run the tests\n  then commit")).toBe("Run the tests then commit");
  });
});

describe("the store", () => {
  beforeEach(() => restoreDefaultPrompts());

  test("starts with the defaults and keeps the edits", () => {
    expect(useSavedPrompts.getState().prompts).toEqual(DEFAULT_PROMPTS);
    saveNewPrompt("Fix the lint errors");
    changePrompt(0, "Go on");
    reorderPrompt(5, 1);
    deletePrompt(2);
    expect(useSavedPrompts.getState().prompts).toEqual(["Go on", "Fix the lint errors", "Run the tests", "Explain the change", "Commit and push"]);
    restoreDefaultPrompts();
    expect(useSavedPrompts.getState().prompts).toEqual(DEFAULT_PROMPTS);
  });

  test("a change with no effect keeps the same state object", () => {
    const before = useSavedPrompts.getState();
    saveNewPrompt("Continue");
    expect(useSavedPrompts.getState()).toBe(before);
  });
});
