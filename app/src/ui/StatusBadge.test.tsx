import { act, create } from "react-test-renderer";

import { StatusBadge, type BadgeStatus } from "./StatusBadge";

const cases: [BadgeStatus, string][] = [
  ["working", "Working"],
  ["blocked", "Needs you"],
  ["idle", "Idle"],
  ["done", "Done"],
  ["unknown", "Unknown"],
  ["offline", "Offline"],
];

describe("StatusBadge", () => {
  it.each(cases)("status_badge_has_label_for_each_status: %s", (status, label) => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<StatusBadge status={status} />);
    });
    const root = tree.root;
    expect(root.findByProps({ accessibilityLabel: label })).toBeTruthy();
    const texts = root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
    expect(texts).toContain(label);
    act(() => tree.unmount());
  });
});
