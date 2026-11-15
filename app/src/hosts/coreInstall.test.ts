import type { CoreStatus } from "@herdling/protocol";

import {
  coreActionLabel,
  coreInstallErrorMessage,
  coreInstallReducer,
  coreInstallText,
  coreStatusLines,
  coreUpdateNote,
  hasCoreStatus,
  initialCoreInstall,
} from "./coreInstall";

const status = (o: Partial<CoreStatus> = {}): CoreStatus => ({
  found: true,
  installed: "0.1.19",
  managed: false,
  running: true,
  running_version: "0.1.19",
  pinned: "0.1.20",
  newer_than_pin: false,
  update_available: true,
  required: false,
  target: "macos-aarch64",
  herdr1: true,
  ...o,
});

test("gate_on_hello_methods", () => {
  expect(hasCoreStatus(undefined)).toBe(false);
  expect(hasCoreStatus({ methods: ["hello"] } as never)).toBe(false);
  expect(hasCoreStatus({ methods: ["core.status"] } as never)).toBe(true);
  // An older herdlingd that does not list its methods gets no card.
  expect(hasCoreStatus({} as never)).toBe(false);
});

test("status_lines_and_action", () => {
  expect(coreStatusLines(status())).toEqual(["Installed: 0.1.19", "Running: 0.1.19", "herdlingd installs 0.1.20.", "herdr 1 is on this computer too."]);
  expect(coreActionLabel(status())).toBe("Update Herdr 2");
  expect(coreActionLabel(status({ found: false, installed: null, running: false }))).toBe("Install Herdr 2");
  expect(coreActionLabel(status({ managed: true }))).toBeNull();
  expect(coreActionLabel(status({ update_available: false }))).toBeNull();
  expect(coreStatusLines(status({ newer_than_pin: true, herdr1: false, update_available: false }))[2]).toBe(
    "herdlingd installs 0.1.20. The core here is newer: herdlingd keeps it.",
  );
  expect(coreStatusLines(status({ found: false, running: false }))[0]).toBe("Not installed");
});

test("install_texts", () => {
  expect(coreInstallText({ from: "0.1.19", to: "0.1.20", status: "updated", started: false, pinned: "0.1.20" })).toBe("Herdr 2 is updated from 0.1.19 to 0.1.20.");
  expect(coreInstallText({ to: "0.1.20", status: "installed", started: true, pinned: "0.1.20" })).toBe("Herdr 2 0.1.20 is installed. herdlingd started it.");
  expect(coreInstallErrorMessage(Object.assign(new Error("x"), { code: "checksum_mismatch" }))).toMatch(/Nothing was installed/);
  expect(coreInstallErrorMessage(new Error("disk full"))).toBe("The Herdr 2 install failed: disk full");
});

test("update_note", () => {
  expect(coreUpdateNote(undefined)).toBeUndefined();
  expect(coreUpdateNote({ requires_core: false, installed: true, herdr1: false, install_first: false, pinned: "0.1.20" })).toBeUndefined();
  expect(
    coreUpdateNote({ requires_core: true, installed: false, herdr1: true, install_first: true, pinned: "0.1.20", notice: "herdr 1 sessions no longer show." }),
  ).toBe("Herdr 2 (herdr-core 0.1.20) installs first. If that fails, herdlingd stays as it is. herdr 1 sessions no longer show.");
});

test("install_machine", () => {
  const r = coreInstallReducer(initialCoreInstall, { type: "press" });
  expect(r).toEqual({ state: { phase: "running", gen: 1 }, effects: [{ type: "run", gen: 1 }] });
  // No second run while one runs.
  expect(coreInstallReducer(r.state, { type: "press" }).effects).toEqual([]);
  // An old result changes nothing.
  expect(coreInstallReducer(r.state, { type: "succeeded", gen: 0, text: "x" }).state).toBe(r.state);
  const done = coreInstallReducer(r.state, { type: "succeeded", gen: 1, text: "ok" }).state;
  expect(done).toEqual({ phase: "done", gen: 1, text: "ok" });
  expect(coreInstallReducer(done, { type: "failed", gen: 1, text: "late" }).state).toBe(done);
  const again = coreInstallReducer(done, { type: "press" });
  expect(again.state).toEqual({ phase: "running", gen: 2 });
  expect(coreInstallReducer(again.state, { type: "failed", gen: 2, text: "no" }).state).toEqual({ phase: "failed", gen: 2, text: "no" });
});
