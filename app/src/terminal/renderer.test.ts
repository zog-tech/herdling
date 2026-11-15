import type { Hello } from "@herdling/protocol";

import { chooseRenderer, hostHasVt } from "./renderer";

const hello = (watch_formats?: string[]): Hello => ({ host: "studio.local", os: "macos", herdlingd: "0.2.0", herdr_ok: true, watch_formats });

describe("chooseRenderer", () => {
  it("uses the terminal when the host and the build have it", () => {
    expect(chooseRenderer("terminal", hello(["text", "ansi", "vt"]), true)).toBe("terminal");
  });
  it("an older herdlingd (no watch_formats, or no vt) keeps the classic view", () => {
    expect(chooseRenderer("terminal", hello(), true)).toBe("classic");
    expect(chooseRenderer("terminal", hello(["text", "ansi"]), true)).toBe("classic");
    expect(chooseRenderer("terminal", undefined, true)).toBe("classic");
    expect(hostHasVt(hello())).toBe(false);
  });
  it("a build without the web view keeps the classic view", () => {
    expect(chooseRenderer("terminal", hello(["vt"]), false)).toBe("classic");
  });
  it("the user can choose the classic view", () => {
    expect(chooseRenderer("classic", hello(["vt"]), true)).toBe("classic");
  });
});
