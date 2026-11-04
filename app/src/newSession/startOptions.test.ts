import {
  buildArgs,
  cleanChoice,
  commandPreview,
  extraFlagCount,
  isDanger,
  modeMenu,
  modeOf,
  optionsFor,
  splitFlags,
  summary,
  thinkingMenu,
  withMode,
  withThinking,
} from "./startOptions";
import { choiceFor, rememberChoice, useStartOptionsMemory } from "./startOptionsMemory";

describe("splitFlags", () => {
  it("splits on spaces and keeps quoted spaces", () => {
    expect(splitFlags("")).toEqual([]);
    expect(splitFlags("   ")).toEqual([]);
    expect(splitFlags("--verbose  --add-dir ../lib")).toEqual(["--verbose", "--add-dir", "../lib"]);
    expect(splitFlags(`--append-system-prompt "be brief please" -x 'a b'`)).toEqual(["--append-system-prompt", "be brief please", "-x", "a b"]);
    expect(splitFlags(`--name="my agent"`)).toEqual(["--name=my agent"]);
    expect(splitFlags(`"it's" 'say "hi"'`)).toEqual(["it's", 'say "hi"']);
  });

  it("keeps an empty quoted argument", () => {
    expect(splitFlags(`--x "" y`)).toEqual(["--x", "", "y"]);
  });

  it("takes the rest of the text after an unbalanced quote as one argument", () => {
    expect(splitFlags(`--a "b c d`)).toEqual(["--a", "b c d"]);
    expect(splitFlags(`--a 'b`)).toEqual(["--a", "b"]);
  });
});

describe("buildArgs", () => {
  it("is empty for the defaults", () => {
    for (const kind of ["claude", "codex", "gemini", "opencode", "pi", "amp"]) expect(buildArgs(kind, {})).toEqual([]);
  });

  it("uses the checked flags of each agent", () => {
    expect(buildArgs("claude", { mode: "plan" })).toEqual(["--permission-mode", "plan"]);
    expect(buildArgs("claude", { mode: "acceptEdits" })).toEqual(["--permission-mode", "acceptEdits"]);
    expect(buildArgs("claude", { mode: "auto" })).toEqual(["--permission-mode", "auto"]);
    expect(buildArgs("claude", { mode: "skip" })).toEqual(["--dangerously-skip-permissions"]);
    expect(buildArgs("codex", { mode: "readOnly" })).toEqual(["--sandbox", "read-only"]);
    expect(buildArgs("codex", { mode: "auto" })).toEqual(["--sandbox", "workspace-write", "--ask-for-approval", "on-request"]);
    expect(buildArgs("codex", { mode: "fullAccess" })).toEqual(["--dangerously-bypass-approvals-and-sandbox"]);
    expect(buildArgs("gemini", { mode: "autoEdit" })).toEqual(["--approval-mode", "auto_edit"]);
    expect(buildArgs("gemini", { mode: "yolo" })).toEqual(["--yolo"]);
    expect(buildArgs("opencode", { mode: "auto" })).toEqual(["--auto"]);
  });

  it("puts the mode, then the model, then the thinking level, then the extra flags", () => {
    expect(buildArgs("claude", { mode: "plan", model: "  opus ", extra: "--verbose" })).toEqual(["--permission-mode", "plan", "--model", "opus", "--verbose"]);
    expect(buildArgs("codex", { model: "gpt-5" })).toEqual(["-m", "gpt-5"]);
    expect(buildArgs("gemini", { model: "gemini-2.5-pro" })).toEqual(["-m", "gemini-2.5-pro"]);
    expect(buildArgs("pi", { model: "sonnet", thinking: "high", extra: "--x" })).toEqual(["--model", "sonnet", "--thinking", "high", "--x"]);
  });

  it("skips an empty model and a model for a kind with no model flag", () => {
    expect(buildArgs("claude", { model: "   " })).toEqual([]);
    expect(buildArgs("opencode", { model: "x" })).toEqual([]);
    expect(buildArgs("amp", { model: "x", extra: "--flag 'a b'" })).toEqual(["--flag", "a b"]);
  });

  it("treats an unknown mode as Default", () => {
    expect(buildArgs("claude", { mode: "nope" })).toEqual([]);
    expect(modeOf("claude", { mode: "nope" })?.id).toBe("default");
    expect(modeOf("pi", {})).toBeUndefined();
  });
});

describe("options per kind", () => {
  it("gives Pi no modes and a thinking choice, and other kinds extra flags only", () => {
    expect(optionsFor("pi").modes).toEqual([]);
    expect(optionsFor("pi").thinking?.levels.map((l) => l.id)).toEqual(["off", "low", "medium", "high"]);
    expect(optionsFor("amp")).toEqual({ modes: [] });
  });

  it("marks only the modes with no approval as danger", () => {
    expect(isDanger("claude", { mode: "skip" })).toBe(true);
    expect(isDanger("codex", { mode: "fullAccess" })).toBe(true);
    expect(isDanger("gemini", { mode: "yolo" })).toBe(true);
    expect(isDanger("opencode", { mode: "auto" })).toBe(true);
    expect(isDanger("claude", { mode: "auto" })).toBe(false);
    expect(isDanger("codex", { mode: "auto" })).toBe(false);
    expect(isDanger("pi", {})).toBe(false);
    expect(isDanger("claude", {})).toBe(false);
  });
});

describe("summary", () => {
  it("says Default when nothing is set", () => {
    expect(summary("claude", {})).toBe("Default");
    expect(summary("amp", { model: "x" })).toBe("Default");
  });

  it("joins the mode, the model, the thinking level and the extra flag count", () => {
    expect(summary("claude", { mode: "plan", model: "opus" })).toBe("Plan · opus");
    expect(summary("claude", { mode: "skip" })).toBe("Skip permissions");
    expect(summary("pi", { thinking: "high" })).toBe("Thinking high");
    expect(summary("codex", { extra: "--a b" })).toBe("2 extra flags");
    expect(summary("codex", { extra: "--a" })).toBe("1 extra flag");
  });
});

describe("stored options", () => {
  beforeEach(() => useStartOptionsMemory.setState({ byKind: {} }));

  it("cleans data of an older or a newer app", () => {
    expect(cleanChoice("claude", undefined)).toEqual({});
    expect(cleanChoice("claude", "junk")).toEqual({});
    expect(cleanChoice("claude", { mode: "gone", model: 3, extra: "--x" })).toEqual({ extra: "--x" });
    expect(cleanChoice("pi", { mode: "plan", thinking: "max", model: "m" })).toEqual({ model: "m" });
    expect(cleanChoice("claude", { mode: "default" })).toEqual({});
  });

  it("remembers the options per kind and falls back to Default for an unknown mode", () => {
    rememberChoice("claude", { mode: "skip", model: "opus" });
    rememberChoice("codex", { mode: "readOnly" });
    const { byKind } = useStartOptionsMemory.getState();
    expect(choiceFor(byKind, "claude")).toEqual({ mode: "skip", model: "opus" });
    expect(choiceFor(byKind, "codex")).toEqual({ mode: "readOnly" });
    expect(choiceFor(byKind, "gemini")).toEqual({});
    expect(choiceFor({ claude: { mode: "removed-mode" } }, "claude")).toEqual({});
    expect(buildArgs("claude", choiceFor({ claude: { mode: "removed-mode" } }, "claude"))).toEqual([]);
  });
});

describe("commandPreview", () => {
  it("shows the agent binary and its flags", () => {
    expect(commandPreview("claude", {})).toBe("claude");
    expect(commandPreview("claude", { mode: "plan", model: "opus" })).toBe("claude --permission-mode plan --model opus");
    expect(commandPreview("pi", { thinking: "low" })).toBe("pi --thinking low");
  });

  it("quotes an argument with a space or a quote", () => {
    expect(commandPreview("amp", { extra: `--name "two words" --q "it's"` })).toBe(`amp --name 'two words' --q "it's"`);
    expect(commandPreview("amp", { extra: `--empty ""` })).toBe("amp --empty ''");
  });
});

describe("pill menus", () => {
  it("lists the modes with a check on the current one, the danger mode red and Cancel last", () => {
    const m = modeMenu("claude", { mode: "plan" })!;
    expect(m.options).toEqual(["Default", "✓ Plan", "Accept edits", "Auto", "Skip permissions", "Cancel"]);
    expect(m.destructiveButtonIndex).toEqual([4]);
    expect(m.cancelButtonIndex).toBe(5);
    expect(m.ids[4]).toBe("skip");
    expect(m.ids[5]).toBeUndefined();
    expect(modeMenu("claude", {})!.options[0]).toBe("✓ Default");
    expect(modeMenu("pi", {})).toBeUndefined();
  });

  it("lists the thinking levels with Default first", () => {
    expect(thinkingMenu("pi", {})!.options).toEqual(["✓ Default", "Off", "Low", "Medium", "High", "Cancel"]);
    expect(thinkingMenu("pi", { thinking: "high" })!.options[4]).toBe("✓ High");
    expect(thinkingMenu("claude", {})).toBeUndefined();
  });

  it("stores Default as no value", () => {
    expect(withMode({ mode: "plan", model: "m" }, "default")).toEqual({ mode: undefined, model: "m" });
    expect(withMode({}, "skip")).toEqual({ mode: "skip" });
    expect(withThinking({ thinking: "low" }, "default")).toEqual({ thinking: undefined });
    expect(withThinking({}, "high")).toEqual({ thinking: "high" });
  });

  it("counts the extra flags", () => {
    expect(extraFlagCount({})).toBe(0);
    expect(extraFlagCount({ extra: "  " })).toBe(0);
    expect(extraFlagCount({ extra: "--a b" })).toBe(2);
  });
});
