import { pillText } from "./elapsed";

test("pill text is the bucket label only", () => {
  expect(pillText("working")).toBe("working");
  expect(pillText("ready")).toBe("ready");
  expect(pillText("needs_you")).toBe("needs you");
  expect(pillText("idle")).toBe("idle");
});
