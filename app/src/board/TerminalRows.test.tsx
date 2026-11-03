import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useTerminalStatus } from "@/herdr/terminalStatus";
import type { BoardTerminal } from "@/herdr/terminals";

import { TerminalRows } from "./TerminalRows";

jest.mock("@/ui/haptics", () => ({ tap: jest.fn() }));

let trees: ReactTestRenderer[] = [];
const render = (el: React.ReactElement) => {
  let t: ReactTestRenderer | undefined;
  act(() => {
    t = create(el);
  });
  trees.push(t!);
  return t!;
};
afterEach(() => {
  act(() => trees.forEach((t) => t.unmount()));
  trees = [];
  useTerminalStatus.setState({ byKey: {} });
});

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

test("shows the status of each polled terminal", () => {
  useTerminalStatus.setState({ byKey: { "h1:p1": { kind: "running", command: "pnpm dev" }, "h1:p2": { kind: "idle" } } });
  const list = [term("p1"), term("p2", { key: "h1:p2" }), term("p3", { key: "h1:p3" })];
  const t = render(<TerminalRows terminals={list} multiHost={false} onOpen={jest.fn()} />);
  const rows = t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Terminal ") && typeof n.props.onPress === "function");
  expect(rows.map((r) => r.props.accessibilityLabel)).toEqual([
    "Terminal proj, Running: pnpm dev, ~/proj",
    "Terminal proj, Idle, ~/proj",
    "Terminal proj, ~/proj",
  ]);
  const dots = t.root.findAll((n) => (n.type as unknown) === "View" && n.props.accessible === true && typeof n.props.accessibilityLabel === "string" && !n.props.accessibilityLabel.startsWith("Terminal "));
  expect(dots.map((d) => d.props.accessibilityLabel)).toEqual(["Running: pnpm dev", "Idle"]);
});
