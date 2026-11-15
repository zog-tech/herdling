import type { MachineSuggestion } from "@herdling/protocol";

import { mergeSuggestions, suggestionDetail, suggestReducer, SUGGEST_START } from "./suggest";
import type { Host } from "./store";

const host = (address: string): Host => ({ id: address, name: address, address, port: 22, user: "sam", command: "herdlingd rpc" });
const s = (name: string, address: string, extra: Partial<MachineSuggestion> = {}): MachineSuggestion => ({ name, address, sources: ["ssh_config"], ...extra });

test("drops_saved_hosts_by_address", () => {
  const list = mergeSuggestions([{ hostName: "studio", suggestions: [s("lab", "Lab.Example"), s("box", "192.0.2.20")] }], [host("lab.example")]);
  expect(list.map((x) => x.name)).toEqual(["box"]);
});

test("merges_the_same_address_from_two_hosts", () => {
  const list = mergeSuggestions(
    [
      { hostName: "studio", suggestions: [s("lab", "lab.example")] },
      { hostName: "build", suggestions: [s("lab-ts", "LAB.example", { sources: ["tailscale"], user: "sam", port: 2222 })] },
    ],
    [],
  );
  expect(list).toHaveLength(1);
  expect(list[0]).toMatchObject({ name: "lab", from: ["studio", "build"], sources: ["ssh_config", "tailscale"], user: "sam", port: 2222 });
  expect(suggestionDetail(list[0])).toBe("sam@lab.example:2222 · SSH config, Tailscale on studio, build");
});

test("old_generation_is_ignored", () => {
  let st = suggestReducer(SUGGEST_START, { type: "load" });
  const first = st.gen;
  st = suggestReducer(st, { type: "load" });
  expect(suggestReducer(st, { type: "loaded", gen: first, list: [] })).toBe(st);
  const done = suggestReducer(st, { type: "loaded", gen: st.gen, list: [] });
  expect(done.status).toBe("ready");
  // A late failure after the result changes nothing.
  expect(suggestReducer(done, { type: "failed", gen: done.gen, error: "x" })).toBe(done);
  expect(suggestReducer(st, { type: "failed", gen: st.gen, error: "x" })).toMatchObject({ status: "failed", error: "x" });
  expect(suggestReducer(done, { type: "reset" })).toEqual({ status: "idle", gen: done.gen + 1 });
});
