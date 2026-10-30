import type { Hello } from "@zogssh/protocol";

import { APP_METHODS, hasMethod, needsZogsshdUpdate } from "./methods";

const hello = (methods?: string[]): Hello => ({ host: "h", os: "linux", zogsshd: "1", herdr_ok: true, methods });

test("hasMethod_is_true_when_methods_is_missing", () => {
  expect(hasMethod(undefined, "agents.preview")).toBe(true);
  expect(hasMethod(hello(), "agents.preview")).toBe(true);
});

test("hasMethod_checks_the_list_when_present", () => {
  expect(hasMethod(hello(["ping"]), "ping")).toBe(true);
  expect(hasMethod(hello(["ping"]), "stats.get")).toBe(false);
});

test("update_hint_when_methods_missing_or_incomplete", () => {
  expect(needsZogsshdUpdate(undefined)).toBe(false);
  expect(needsZogsshdUpdate(hello())).toBe(true);
  expect(needsZogsshdUpdate(hello(APP_METHODS.slice(1)))).toBe(true);
  expect(needsZogsshdUpdate(hello([...APP_METHODS]))).toBe(false);
});
