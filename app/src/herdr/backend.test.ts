import { RpcError } from "@/rpc/RpcClient";

import {
  allows,
  assertAllows,
  backendLabel,
  CORE_LABEL,
  CORE_UNSUPPORTED,
  coreActions,
  isCore,
  renameKindsFor,
  setCoreActions,
  useCoreActions,
  type HerdrOneAction,
} from "./backend";

const ACTIONS: HerdrOneAction[] = ["rename", "restart", "resume", "newTab", "explain", "closeGroup", "shellWatch", "thread"];

describe("isCore", () => {
  it("knows a Herdr 2 id by its prefix", () => {
    expect(isCore("hc:t7")).toBe(true);
    expect(isCore("hc:space:3")).toBe(true);
    expect(isCore("hc:loose")).toBe(true);
    expect(isCore("w1:p2")).toBe(false);
    expect(isCore("p1")).toBe(false);
    expect(isCore("")).toBe(false);
    expect(isCore(undefined)).toBe(false);
    expect(isCore(null)).toBe(false);
  });

  it("knows a Herdr 2 entry by its backend field or its own id", () => {
    expect(isCore({ backend: "core", pane_id: "x" })).toBe(true);
    expect(isCore({ pane_id: "hc:t1", tab_id: "hc:tab:1", workspace_id: "hc:space:1" })).toBe(true);
    expect(isCore({ workspace_id: "hc:space:1" })).toBe(true);
    expect(isCore({ tab_id: "hc:loose:tab", workspace_id: "hc:loose" })).toBe(true);
    // A herdr 1 entry has no backend field.
    expect(isCore({ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1" })).toBe(false);
    expect(isCore({ backend: null, pane_id: "p1" })).toBe(false);
  });

  it("skips an empty id, as the workspace rename target has", () => {
    expect(isCore({ pane_id: "", tab_id: "", workspace_id: "hc:space:1" })).toBe(true);
    expect(isCore({ pane_id: "", tab_id: "", workspace_id: "w1" })).toBe(false);
  });
});

describe("allows", () => {
  it("allows every action on a herdr 1 entry", () => {
    for (const a of ACTIONS) expect(allows({ pane_id: "w1:p1" }, a)).toBe(true);
    for (const a of ACTIONS) expect(allows(undefined, a)).toBe(true);
  });

  it("hides every herdr 1 action on a Herdr 2 entry", () => {
    for (const a of ACTIONS) expect(allows({ pane_id: "hc:t1", backend: "core" }, a)).toBe(false);
    for (const a of ACTIONS) expect(allows("hc:t1", a)).toBe(false);
  });

  it("assertAllows throws an unsupported RpcError only for a Herdr 2 entry", () => {
    expect(() => assertAllows("w1:p1", "restart")).not.toThrow();
    let err: unknown;
    try {
      assertAllows("hc:t1", "restart");
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(CORE_UNSUPPORTED);
    expect((err as RpcError).message).toMatch(/herdlingd/);
  });
});

describe("core actions per host", () => {
  beforeEach(() => useCoreActions.setState({ hosts: {} }));

  it("needs session.start in hello.methods", () => {
    expect(coreActions({ methods: ["hello", "session.start"] })).toBe(true);
    expect(coreActions({ methods: ["hello", "groups.list"] })).toBe(false);
    // An older herdlingd that does not list its methods: the old rule.
    expect(coreActions({})).toBe(false);
    expect(coreActions(undefined)).toBe(false);
  });

  it("allows every action on a core entry of a host with the plan C methods", () => {
    setCoreActions("h1", { methods: ["session.start"] });
    setCoreActions("h2", { methods: ["hello"] });
    for (const a of ACTIONS) {
      expect(allows("hc:t1", a, "h1")).toBe(true);
      expect(allows("hc:t1", a, "h2")).toBe(false);
      expect(allows("hc:t1", a)).toBe(false);
      expect(allows("w1:p1", a, "h2")).toBe(true);
    }
    expect(() => assertAllows("hc:t1", "restart", "h1")).not.toThrow();
    expect(() => assertAllows("hc:t1", "restart", "h2")).toThrow(RpcError);
  });

  it("keeps the last value when the host has no hello, and drops it on a new hello", () => {
    setCoreActions("h1", { methods: ["session.start"] });
    setCoreActions("h1", undefined);
    expect(allows("hc:t1", "thread", "h1")).toBe(true);
    setCoreActions("h1", { methods: ["hello"] });
    expect(allows("hc:t1", "thread", "h1")).toBe(false);
  });
});

describe("renameKindsFor", () => {
  it("gives a Herdr 2 entry only the task name", () => {
    expect(renameKindsFor("hc:t1")).toEqual(["session"]);
    expect(renameKindsFor({ pane_id: "w1:p1" })).toEqual(["session", "tab", "workspace"]);
  });
});

describe("backendLabel", () => {
  it("labels only Herdr 2 entries", () => {
    expect(backendLabel({ workspace_id: "hc:space:1", backend: "core" })).toBe(CORE_LABEL);
    expect(CORE_LABEL).toBe("Herdr 2");
    expect(backendLabel({ workspace_id: "w1" })).toBeUndefined();
  });
});
