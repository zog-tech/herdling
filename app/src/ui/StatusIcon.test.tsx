import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StatusBadge, statusLabel } from "./StatusBadge";
import { StatusIcon, statusMeta, statusSpoken, statusText, type BadgeStatus } from "./StatusIcon";
import { pillContent } from "./StatusRow";

jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

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

test("a_status_the_app_does_not_know_renders_as_unknown_and_does_not_throw", () => {
  // A newer herdr can add a status, and `pane_agent_status_changed` passes it on unchecked.
  const odd = "starting" as BadgeStatus;
  expect(statusMeta(odd)).toBe(statusMeta("unknown"));
  expect(statusText(odd)).toBe("Unknown");
  expect(statusSpoken(odd, 30)).toBe("Unknown");
  expect(statusLabel(odd)).toBe("Unknown");
  expect(pillContent(odd).label).toBe("Unknown");
  // A status named like an object property must not find `Object.prototype`.
  expect(statusMeta("constructor" as BadgeStatus)).toBe(statusMeta("unknown"));
  let t!: ReactTestRenderer;
  act(() => {
    t = create(
      <>
        <StatusIcon status={odd} />
        <StatusBadge status={odd} />
      </>,
    );
  });
  expect(spinning(t)).toBe(false);
  act(() => t.unmount());
});
