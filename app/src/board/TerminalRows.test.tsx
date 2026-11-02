import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { BoardTerminal } from "@/herdr/terminals";

import { TerminalRows } from "./TerminalRows";

jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));

const render = (el: React.ReactElement) => {
  let t: ReactTestRenderer | undefined;
  act(() => {
    t = create(el);
  });
  return t!;
};

const term = (paneId: string, extra: Partial<BoardTerminal> = {}): BoardTerminal => ({
  key: `h1:${paneId}`,
  hostId: "h1",
  hostName: "studio",
  paneId,
  title: "proj",
  folder: "/home/sam/proj",
  ...extra,
});

test("shows nothing with no terminals", () => {
  const t = render(<TerminalRows terminals={[]} multiHost={false} onOpen={jest.fn()} />);
  expect(t.toJSON()).toBeNull();
});

test("lists each terminal with its folder and opens it on a tap", () => {
  const onOpen = jest.fn();
  const list = [term("p1"), term("p2", { title: "npm run dev", hostName: "build", hostId: "h2", key: "h2:p2" })];
  const t = render(<TerminalRows terminals={list} multiHost onOpen={onOpen} selectedKey="h2:p2" />);
  const rows = t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Terminal ") && typeof n.props.onPress === "function");
  expect(rows.map((r) => r.props.accessibilityLabel)).toEqual(["Terminal proj, studio · ~/proj", "Terminal npm run dev, build · ~/proj"]);
  expect(rows[1].props.accessibilityState).toEqual({ selected: true });
  act(() => rows[1].props.onPress());
  expect(onOpen).toHaveBeenCalledWith(list[1]);
});
