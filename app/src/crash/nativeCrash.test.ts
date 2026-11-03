import { CRASH_LOG_KEY, crashLogText, encodeLog, makeEntry, parseLog, useCrashLog } from "./crashLog";
import { importNativeCrash, type NativeCrashSource } from "./nativeCrash";

const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn((k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn((k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async (k: string) => void mockStore.delete(k)),
}));
// A build without the native module (build 6 and older).
jest.mock("expo", () => ({ NativeModule: class {}, requireOptionalNativeModule: () => null }));

beforeEach(() => {
  mockStore.clear();
  useCrashLog.setState({ entries: [] });
});

const source = (text: string | null, at = 5_000): NativeCrashSource & { clear: jest.Mock } => ({
  read: jest.fn(async () => (text ? { at, text } : null)),
  clear: jest.fn(async () => {}),
});

test("a_saved_native_crash_goes_into_the_crash_log_and_the_file_is_cleared", async () => {
  mockStore.set(CRASH_LOG_KEY, encodeLog([makeEntry(new Error("older js"), "fatal", {}, 1_000), makeEntry(new Error("newer js"), "screen", {}, 9_000)]));
  const src = source("NSInternalInconsistencyException: Unhandled JS Exception\n0 CoreFoundation 0x1\n1 libobjc 0x2", 5_000);
  await expect(importNativeCrash(src)).resolves.toBe(true);
  expect(src.clear).toHaveBeenCalledTimes(1);
  const stored = parseLog(mockStore.get(CRASH_LOG_KEY));
  // Time order: the native crash goes between the two JS entries.
  expect(stored.map((e) => e.kind)).toEqual(["fatal", "native", "screen"]);
  expect(stored[1]).toMatchObject({
    time: 5_000,
    kind: "native",
    message: "NSInternalInconsistencyException: Unhandled JS Exception",
    stack: "0 CoreFoundation 0x1\n1 libobjc 0x2",
  });
  expect(useCrashLog.getState().entries).toHaveLength(3);
  expect(crashLogText(stored)).toContain("Native: NSInternalInconsistencyException");
});

test("no_saved_crash_changes_nothing", async () => {
  const src = source(null);
  await expect(importNativeCrash(src)).resolves.toBe(false);
  expect(src.clear).not.toHaveBeenCalled();
  expect(mockStore.has(CRASH_LOG_KEY)).toBe(false);
});

test("a_build_without_the_native_module_does_nothing", async () => {
  await expect(importNativeCrash()).resolves.toBe(false);
  expect(mockStore.has(CRASH_LOG_KEY)).toBe(false);
  expect(useCrashLog.getState().entries).toEqual([]);
});

test("a_failed_read_never_throws", async () => {
  const src: NativeCrashSource = { read: () => Promise.reject(new Error("io")), clear: jest.fn(async () => {}) };
  await expect(importNativeCrash(src)).resolves.toBe(false);
  expect(src.clear).not.toHaveBeenCalled();
});
