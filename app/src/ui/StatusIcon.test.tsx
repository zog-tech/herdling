import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StatusIcon, statusText } from "./StatusIcon";

const spinning = (t: ReactTestRenderer) =>
  t.root.findAll((n) => (n.type as unknown) === "View" && !!n.props.style?.animationName).length > 0;

test("status_text_adds_elapsed_only_while_working", () => {
  expect(statusText("working", 72)).toBe("Working 1m 12s");
  expect(statusText("working")).toBe("Working");
  expect(statusText("blocked", 30)).toBe("Needs you");
  expect(statusText("done", 30)).toBe("Done");
});

test("only_working_spins", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StatusIcon status="working" />);
  });
  expect(spinning(t)).toBe(true);
  act(() => t.update(<StatusIcon status="done" />));
  expect(spinning(t)).toBe(false);
  act(() => t.unmount());
});
