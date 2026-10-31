import { KeyRegistry, nativeCommands } from "./keyCommands";

describe("KeyRegistry", () => {
  it("runs the newest handler for an id", () => {
    const r = new KeyRegistry();
    const first = jest.fn();
    const second = jest.fn();
    r.add("send", first);
    const removeSecond = r.add("send", second);
    expect(r.dispatch("send")).toBe(true);
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
    // The session on top closes: the one below gets the shortcut again.
    removeSecond();
    r.dispatch("send");
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("returns false for an id with no handler", () => {
    const r = new KeyRegistry();
    expect(r.dispatch("send")).toBe(false);
    const remove = r.add("send", () => {});
    remove();
    expect(r.dispatch("send")).toBe(false);
  });

  it("lists the active ids and reports each change", () => {
    const onChange = jest.fn();
    const r = new KeyRegistry(onChange);
    const a = r.add("tab1", () => {});
    r.add("tab1", () => {});
    r.add("send", () => {});
    expect([...r.ids()].sort()).toEqual(["send", "tab1"]);
    expect(onChange).toHaveBeenCalledTimes(3);
    a();
    a();
    // A second remove of the same handler changes nothing.
    expect(onChange).toHaveBeenCalledTimes(4);
    expect([...r.ids()].sort()).toEqual(["send", "tab1"]);
  });
});

describe("nativeCommands", () => {
  it("sends the table entries for the active ids", () => {
    expect(nativeCommands(new Set(["escape", "send"]))).toEqual([
      { id: "send", input: "enter", modifiers: ["command"], title: "Send Prompt" },
      { id: "escape", input: "escape", modifiers: [], title: "Send Esc" },
    ]);
  });
});
