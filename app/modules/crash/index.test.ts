/** The JS side of the `crash` module, with and without the native module (an older build). */
function load(native: object | null) {
  jest.resetModules();
  jest.doMock("expo", () => ({ NativeModule: class {}, requireOptionalNativeModule: () => native }));
  return require("./index") as typeof import("./index");
}

describe("crash module", () => {
  afterEach(() => jest.dontMock("expo"));

  it("does nothing on a build without the native module", async () => {
    const crash = load(null);
    expect(crash.hasNativeCrashCapture).toBe(false);
    await expect(crash.readNativeCrash()).resolves.toBeNull();
    await expect(crash.clearNativeCrash()).resolves.toBeUndefined();
  });

  it("reads and clears the saved crash", async () => {
    const native = {
      read: jest.fn(() => Promise.resolve("1700000000000\nNSInvalidArgumentException: bad\n0 CoreFoundation 0x1")),
      clear: jest.fn(() => Promise.resolve()),
    };
    const crash = load(native);
    expect(crash.hasNativeCrashCapture).toBe(true);
    await expect(crash.readNativeCrash()).resolves.toEqual({
      at: 1_700_000_000_000,
      text: "NSInvalidArgumentException: bad\n0 CoreFoundation 0x1",
    });
    await crash.clearNativeCrash();
    expect(native.clear).toHaveBeenCalled();
  });

  it("a_failed_native_call_gives_null_and_never_throws", async () => {
    const crash = load({ read: () => Promise.reject(new Error("io")), clear: () => Promise.reject(new Error("io")) });
    await expect(crash.readNativeCrash()).resolves.toBeNull();
    await expect(crash.clearNativeCrash()).resolves.toBeUndefined();
  });

  it("parses_the_file_text", () => {
    const { parseNativeCrash } = load(null);
    expect(parseNativeCrash(null)).toBeNull();
    expect(parseNativeCrash("")).toBeNull();
    expect(parseNativeCrash("1700000000000\n")).toBeNull();
    expect(parseNativeCrash("1700000000000")).toBeNull();
    expect(parseNativeCrash("12\njava.lang.RuntimeException: x\n")).toEqual({ at: 12, text: "java.lang.RuntimeException: x" });
    // A damaged time line still keeps the text.
    const got = parseNativeCrash("not a time\nboom");
    expect(got?.text).toBe("boom");
    expect(got?.at).toBeGreaterThan(0);
  });
});
