const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItemAsync: async (k: string) => mockStore.get(k) ?? null,
  setItemAsync: async (k: string, v: string) => void mockStore.set(k, v),
  deleteItemAsync: async (k: string) => void mockStore.delete(k),
}));

let mockProjectId: string | undefined = "proj-1";
jest.mock("expo-constants", () => ({
  __esModule: true,
  default: {
    get expoConfig() {
      return { extra: { eas: { projectId: mockProjectId } } };
    },
  },
}));

const mockNotif = {
  getPermissionsAsync: jest.fn(),
  requestPermissionsAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
};
jest.mock("expo-notifications", () => ({
  getPermissionsAsync: () => mockNotif.getPermissionsAsync(),
  requestPermissionsAsync: () => mockNotif.requestPermissionsAsync(),
  getExpoPushTokenAsync: (o: unknown) => mockNotif.getExpoPushTokenAsync(o),
}));

type TokenModule = typeof import("./token");

/** A fresh module, so the in-memory cache starts empty. */
function load(): TokenModule {
  let mod!: TokenModule;
  jest.isolateModules(() => {
    mod = require("./token");
  });
  return mod;
}

let warn: jest.SpyInstance;
beforeEach(() => {
  mockStore.clear();
  mockProjectId = "proj-1";
  mockNotif.getPermissionsAsync.mockReset().mockResolvedValue({ granted: false, canAskAgain: true });
  mockNotif.requestPermissionsAsync.mockReset().mockResolvedValue({ granted: true, canAskAgain: true });
  mockNotif.getExpoPushTokenAsync.mockReset().mockResolvedValue({ data: "ExponentPushToken[test]" });
  warn = jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => warn.mockRestore());

describe("getExpoToken", () => {
  it("concurrent_calls_ask_permission_once", async () => {
    const { getExpoToken } = load();
    const tokens = await Promise.all([getExpoToken(), getExpoToken(), getExpoToken()]);
    expect(tokens).toEqual(["ExponentPushToken[test]", "ExponentPushToken[test]", "ExponentPushToken[test]"]);
    expect(mockNotif.requestPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(mockNotif.getExpoPushTokenAsync).toHaveBeenCalledTimes(1);
    expect(mockNotif.getExpoPushTokenAsync).toHaveBeenCalledWith({ projectId: "proj-1" });
  });

  it("null_without_project_id", async () => {
    mockProjectId = undefined;
    const { getExpoToken } = load();
    expect(await getExpoToken()).toBeNull();
    expect(mockNotif.requestPermissionsAsync).not.toHaveBeenCalled();
  });

  it("denied_permission_gives_null_and_clears_saved_token", async () => {
    mockStore.set("herdling.expo_token", "ExponentPushToken[old]");
    mockNotif.requestPermissionsAsync.mockResolvedValue({ granted: false, canAskAgain: false });
    const { getExpoToken } = load();
    expect(await getExpoToken()).toBeNull();
    expect(mockStore.has("herdling.expo_token")).toBe(false);
  });

  it("transient_failure_keeps_last_good_token", async () => {
    // A good token from an earlier launch.
    expect(await load().getExpoToken()).toBe("ExponentPushToken[test]");
    mockNotif.getExpoPushTokenAsync.mockRejectedValue(new Error("network down"));
    expect(await load().getExpoToken()).toBe("ExponentPushToken[test]");
  });

  it("failure_retries_on_next_call", async () => {
    mockNotif.getExpoPushTokenAsync.mockRejectedValueOnce(new Error("network down"));
    const { getExpoToken } = load();
    expect(await getExpoToken()).toBeNull();
    expect(await getExpoToken()).toBe("ExponentPushToken[test]");
  });
});
