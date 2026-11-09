import { explainAgent, explainView, parseExplain, stateWord, type AgentExplain } from "./explain";
import { useHerdrSupport } from "./support";

beforeEach(() => useHerdrSupport.setState({ missing: {} }));

/** A cut of a real `herdr agent explain --json` answer (herdr 0.9.5). */
const WORKING: AgentExplain = {
  agent: "claude",
  state: "working",
  manifest_source: "remote:/home/sam/.local/state/herdr/agent-detection/remote/claude.toml",
  manifest_version: "2026.10.11.1",
  matched_rule: { id: "osc_title_working", priority: 1100, region: "osc_title", state: "working" },
  evaluated_rules: [
    { id: "osc_title_working", matched: true, priority: 1100, region: "osc_title", state: "working", evidence: { region_preview: "◐ Claude Code" } },
    { id: "background_agents_working", matched: true, priority: 965, region: "last_non_empty_above_prompt_box", state: "working" },
    { id: "live_blocked_form", matched: false, priority: 980, region: "after_last_horizontal_rule", state: "blocked" },
  ],
  fallback_reason: null,
  skip_state_update: false,
  skipped_update_reason: null,
  screen_detection_skipped: false,
  warning: null,
};

describe("explainView", () => {
  it("says which rule set the status", () => {
    const v = explainView(WORKING);
    expect(v.summary).toBe("herdr shows this agent as working.");
    expect(v.reasons).toEqual(['The rule "osc_title_working" matched in the region "osc_title".']);
    expect(v.fields).toEqual(
      expect.arrayContaining([
        { label: "Agent", value: "claude" },
        { label: "Status", value: "working" },
        { label: "Rule", value: "osc_title_working", mono: true },
        { label: "Rules checked", value: "3 (2 matched)" },
      ]),
    );
    expect(v.matched.map((m) => m.id)).toEqual(["osc_title_working", "background_agents_working"]);
    expect(v.matched[0].detail).toBe("working · osc_title · priority 1100");
    expect(v.evidence).toBe("◐ Claude Code");
    expect(v.uncertain).toBe(false);
  });

  it("explains a fallback, a kept status and a warning", () => {
    const v = explainView({
      state: "unknown",
      matched_rule: null,
      fallback_reason: "no idle prompt visible",
      skip_state_update: true,
      skipped_update_reason: "screen is scrolled",
      warning: "manifest is old",
    });
    expect(v.summary).toBe("herdr shows this agent as unknown.");
    expect(v.reasons).toEqual([
      "No rule decided the status. herdr used a fallback: no idle prompt visible.",
      "herdr kept the last status: screen is scrolled.",
      "Warning: manifest is old",
    ]);
    expect(v.uncertain).toBe(true);
    expect(v.evidence).toBeUndefined();
  });

  it("says when a hook reports the status", () => {
    const v = explainView({ state: "idle", screen_detection_skipped: true, screen_detection_skip_reason: "full lifecycle hook authority" });
    expect(v.reasons[0]).toBe("herdr does not read the screen for this agent: full lifecycle hook authority.");
    expect(v.uncertain).toBe(false);
  });

  it("has a sentence for an empty answer", () => {
    const v = explainView({});
    expect(v.reasons).toEqual(["No rule matched the screen of this agent."]);
    expect(v.fields).toEqual([{ label: "Status", value: "unknown" }]);
  });

  it("uses the app words for the states", () => {
    expect(stateWord("blocked")).toBe("needs you");
    expect(stateWord("other")).toBe("other");
    expect(stateWord(null)).toBe("unknown");
  });
});

describe("explainAgent", () => {
  it("sends agent.explain with the pane as target and reads the explain object", async () => {
    const rpc = { call: jest.fn(async () => ({ type: "agent_explain", explain: WORKING }) as never) };
    expect(await explainAgent(rpc, "h1", "w1:p1")).toEqual(WORKING);
    expect(rpc.call).toHaveBeenCalledWith("herdr.call", { method: "agent.explain", params: { target: "w1:p1" } }, undefined);
    expect(parseExplain(WORKING)).toEqual(WORKING);
  });
});
