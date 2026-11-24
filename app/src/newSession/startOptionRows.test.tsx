import { agentOptions, NOT_INSTALLED } from "./AgentPicker";
import { SHELL_CHOICE } from "./installed";
import { extraFlagsDetail, startOptionRows } from "./StartOptionsBar";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));

describe("startOptionRows", () => {
  test("an agent with modes has a Permissions row and no Thinking row", () => {
    expect(startOptionRows("claude")).toEqual({ permissions: true, thinking: false });
  });
  test("Pi has a Thinking row and no Permissions row", () => {
    expect(startOptionRows("pi")).toEqual({ permissions: false, thinking: true });
  });
  test("an unknown kind has only the Options row", () => {
    expect(startOptionRows("letta")).toEqual({ permissions: false, thinking: false });
  });
});

describe("extraFlagsDetail", () => {
  test("says nothing with no extra flag, and counts the flags", () => {
    expect(extraFlagsDetail(0)).toBeUndefined();
    expect(extraFlagsDetail(1)).toBe("1 extra flag");
    expect(extraFlagsDetail(3)).toBe("3 extra flags");
  });
});

describe("agentOptions", () => {
  test("Shell is first, and an agent that is not installed goes last with a detail", () => {
    const options = agentOptions({ installed: ["claude"], missing: ["codex"] });
    expect(options[0]).toMatchObject({ value: SHELL_CHOICE, label: "Shell" });
    expect(options.at(-1)).toMatchObject({ value: "codex", label: "Codex", detail: NOT_INSTALLED });
    expect(options.find((o) => o.value === "claude")?.detail).toBeUndefined();
  });
  test("with no answer from the computer, no agent is marked", () => {
    expect(agentOptions(undefined).filter((o) => o.detail === NOT_INSTALLED)).toHaveLength(0);
  });
});
