/** The JS side of the `paste` module on each platform, with and without the native modules (older builds). */
function load(os: "ios" | "android", modules: Record<string, object>) {
  jest.resetModules();
  jest.doMock("expo", () => ({ NativeModule: class {}, requireOptionalNativeModule: (n: string) => modules[n] ?? null }));
  jest.doMock("react-native", () => ({ Platform: { OS: os } }));
  return require("./index") as typeof import("./index");
}

const listenerModule = <T extends object>(extra: T = {} as T) => {
  const remove = jest.fn();
  return { remove, addListener: jest.fn(() => ({ remove })), ...extra };
};

describe("paste module", () => {
  afterEach(() => {
    jest.dontMock("expo");
    jest.dontMock("react-native");
  });

  it("offers nothing on a build without the modules", () => {
    for (const os of ["ios", "android"] as const) {
      const paste = load(os, {});
      expect(paste.hasNativePaste).toBe(false);
      expect(paste.hasVideoPaste).toBe(false);
      expect(() => paste.addPasteVideoListener(() => {}, 1)()).not.toThrow();
    }
  });

  it("an_older_ios_build_pastes_images_but_not_videos", () => {
    const paste = load("ios", { HerdlingPaste: listenerModule() });
    expect(paste.hasNativePaste).toBe(true);
    expect(paste.hasVideoPaste).toBe(false);
  });

  it("an_ios_build_with_video_paste_sets_the_limit_and_listens", () => {
    const native = listenerModule({ video: true, setVideoMaxBytes: jest.fn() });
    const paste = load("ios", { HerdlingPaste: native });
    expect(paste.hasVideoPaste).toBe(true);
    const stop = paste.addPasteVideoListener(() => {}, 500);
    expect(native.setVideoMaxBytes).toHaveBeenCalledWith(500);
    expect(native.addListener).toHaveBeenCalledWith("onPasteVideo", expect.any(Function));
    stop();
    expect(native.remove).toHaveBeenCalled();
  });

  it("android_has_no_image_hook_and_attaches_the_video_hook_to_the_focused_input", () => {
    const native = listenerModule({ attach: jest.fn(), detach: jest.fn() });
    const paste = load("android", { HerdlingVideoPaste: native, HerdlingPaste: listenerModule() });
    expect(paste.hasNativePaste).toBe(false);
    expect(paste.hasVideoPaste).toBe(true);
    const stop = paste.addPasteVideoListener(() => {}, 25);
    expect(native.attach).toHaveBeenCalledWith(25);
    stop();
    expect(native.detach).toHaveBeenCalled();
    expect(native.remove).toHaveBeenCalled();
  });
});
