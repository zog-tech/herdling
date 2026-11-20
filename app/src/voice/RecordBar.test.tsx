import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { RecordBar } from "./RecordBar";

jest.mock("./Waveform", () => ({ Waveform: () => null }));

const buttons = (t: ReactTestRenderer) =>
  t.root.findAll((n) => typeof n.props.accessibilityLabel === "string" && !!n.props.onPress).map((n) => n.props.accessibilityLabel);

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

test("a_tap_started_recording_has_discard_and_stop_buttons", () => {
  const onStop = jest.fn();
  act(() => {
    tree = create(<RecordBar phase="recording" onCancel={jest.fn()} onRetry={jest.fn()} onDiscard={jest.fn()} onStop={onStop} />);
  });
  expect(buttons(tree!)).toEqual(["Discard recording", "Stop and transcribe"]);
  act(() => tree!.root.find((n) => n.props.accessibilityLabel === "Stop and transcribe" && !!n.props.onPress).props.onPress());
  expect(onStop).toHaveBeenCalledTimes(1);
});

test("a_hold_has_no_stop_button", () => {
  act(() => {
    tree = create(<RecordBar phase="recording" onCancel={jest.fn()} onRetry={jest.fn()} onDiscard={jest.fn()} />);
  });
  expect(buttons(tree!)).toEqual(["Discard recording"]);
});
