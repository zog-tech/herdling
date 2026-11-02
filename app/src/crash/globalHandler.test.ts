const mockStore = new Map<string, string>();
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn((k: string) => mockStore.get(k) ?? null),
  setItem: jest.fn((k: string, v: string) => void mockStore.set(k, v)),
  deleteItemAsync: jest.fn(async () => {}),
}));
jest.mock("expo-updates", () => ({ isEmbeddedLaunch: false, updateId: "488f5e09-aaaa-bbbb-cccc-000000000000" }));

type Handler = (error: unknown, isFatal?: boolean) => void;

/** A fresh copy of the modules, so each test installs the handler once. */
function setup() {
  let current: Handler = jest.fn();
  const previous = current as jest.Mock;
  const utils = { getGlobalHandler: () => current, setGlobalHandler: (h: Handler) => (current = h) };
  let mod!: typeof import("./globalHandler");
  let log!: typeof import("./crashLog");
  jest.isolateModules(() => {
    mod = require("./globalHandler");
    log = require("./crashLog");
  });
  mod.installCrashHandler(utils);
  return { mod, log, previous, fire: (e: unknown, fatal?: boolean) => current(e, fatal) };
}

beforeEach(() => mockStore.clear());

test("a_fatal_error_is_saved_before_the_previous_handler_runs", () => {
  const { mod, log, previous, fire } = setup();
  mod.setCrashRoute("/session/h1/w1:p2");
  let savedFirst = false;
  previous.mockImplementation(() => {
    savedFirst = log.parseLog(mockStore.get(log.CRASH_LOG_KEY)).length === 1;
  });
  const error = new TypeError("Cannot read properties of null (reading 'charAt')");
  fire(error, true);
  expect(previous).toHaveBeenCalledWith(error, true);
  expect(savedFirst).toBe(true);
  const [entry] = log.parseLog(mockStore.get(log.CRASH_LOG_KEY));
  expect(entry).toMatchObject({ kind: "fatal", route: "/session/h1/w1:p2", update: "488f5e09" });
});

test("a_non_fatal_error_is_not_saved_but_still_goes_to_the_previous_handler", () => {
  const { log, previous, fire } = setup();
  fire(new Error("soft"), false);
  expect(previous).toHaveBeenCalledTimes(1);
  expect(mockStore.has(log.CRASH_LOG_KEY)).toBe(false);
});

test("the_handler_installs_only_once", () => {
  const { mod } = setup();
  const set = jest.fn();
  mod.installCrashHandler({ getGlobalHandler: () => jest.fn(), setGlobalHandler: set });
  expect(set).not.toHaveBeenCalled();
});
