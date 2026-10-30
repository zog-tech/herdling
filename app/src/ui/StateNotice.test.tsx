import { CircleSlash } from "lucide-react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { StateNotice } from "./StateNotice";

test("state_notice_says_what_is_true_and_offers_retry", () => {
  const retry = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<StateNotice Icon={CircleSlash} message="studio is offline" action="Retry" onAction={retry} />);
  });
  const texts = t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => n.props.children);
  expect(texts).toEqual(expect.arrayContaining(["studio is offline", "Retry"]));
  act(() => t.root.find((n) => n.props.accessibilityLabel === "Retry" && !!n.props.onPress).props.onPress());
  expect(retry).toHaveBeenCalledTimes(1);
  // No action: no button.
  act(() => t.update(<StateNotice Icon={CircleSlash} message="Connecting…" />));
  expect(t.root.findAll((n) => n.props.accessibilityRole === "button")).toHaveLength(0);
  act(() => t.unmount());
});
