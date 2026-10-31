/** The JS side of the `keys` module, with and without the native module (an older build). */
type Listener = (e: { id: string }) => void;

function load(native: object | null) {
  jest.resetModules();
  jest.doMock("expo", () => ({ NativeModule: class {}, requireOptionalNativeModule: () => native }));
  return require("./index") as typeof import("./index");
}

describe("keys module", () => {
  afterEach(() => jest.dontMock("expo"));

  it("does nothing on a build without the native module", () => {
    const keys = load(null);
    expect(keys.hasKeyCommands).toBe(false);
    expect(() => keys.setKeyCommands([{ id: "send", input: "enter", modifiers: ["command"], title: "Send" }])).not.toThrow();
    const stop = keys.addKeyCommandListener(() => {});
    expect(() => stop()).not.toThrow();
  });

  it("sends the list and passes key presses on", () => {
    let listener: Listener | undefined;
    const remove = jest.fn();
    const native = {
      setCommands: jest.fn(() => Promise.resolve()),
      addListener: jest.fn((_name: string, l: Listener) => {
        listener = l;
        return { remove };
      }),
    };
    const keys = load(native);
    expect(keys.hasKeyCommands).toBe(true);
    const list = [{ id: "send", input: "enter", modifiers: ["command" as const], title: "Send" }];
    keys.setKeyCommands(list);
    expect(native.setCommands).toHaveBeenCalledWith(list);

    const cb = jest.fn();
    const stop = keys.addKeyCommandListener(cb);
    expect(native.addListener).toHaveBeenCalledWith("onKeyCommand", expect.any(Function));
    listener?.({ id: "send" });
    expect(cb).toHaveBeenCalledWith("send");
    stop();
    expect(remove).toHaveBeenCalled();
  });
});
