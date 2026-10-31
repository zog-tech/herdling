import type { Hello } from "@herdling/protocol";

import { APP_METHODS, hasMethod, needsHerdlingdUpdate } from "./methods";

const hello = (methods?: string[]): Hello => ({ host: "h", os: "linux", herdlingd: "1", herdr_ok: true, methods });

test("hasMethod_is_true_when_methods_is_missing", () => {
  expect(hasMethod(undefined, "agents.preview")).toBe(true);
  expect(hasMethod(hello(), "agents.preview")).toBe(true);
});

test("hasMethod_checks_the_list_when_present", () => {
  expect(hasMethod(hello(["ping"]), "ping")).toBe(true);
  expect(hasMethod(hello(["ping"]), "stats.get")).toBe(false);
});

test("update_hint_when_methods_missing_or_incomplete", () => {
  expect(needsHerdlingdUpdate(undefined)).toBe(false);
  expect(needsHerdlingdUpdate(hello())).toBe(true);
  expect(needsHerdlingdUpdate(hello(APP_METHODS.slice(1)))).toBe(true);
  expect(needsHerdlingdUpdate(hello([...APP_METHODS]))).toBe(false);
});
