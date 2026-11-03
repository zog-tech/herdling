import { Dimensions, Keyboard, Platform, Text, View, type KeyboardEvent } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useDisplayLog } from "./displayLog";
import { fallbackKeyboardHeight, KeyboardAvoider, keyboardOverlap, keyboardTopOf, resetKeyboardMemory } from "./KeyboardAvoider";

describe("keyboardTopOf", () => {
  it("uses screenY when it is real", () => {
    expect(keyboardTopOf(538, 336, 874)).toBe(538);
  });
  it("uses the window height minus the keyboard height when screenY is 0", () => {
    expect(keyboardTopOf(0, 336, 874)).toBe(538);
  });
  it("gives 0 when neither value is real", () => {
    expect(keyboardTopOf(0, 0, 874)).toBe(0);
  });
  it("keeps a hidden keyboard at the window bottom", () => {
    expect(keyboardTopOf(874, 336, 874)).toBe(874);
    expect(keyboardTopOf(875.5, 336, 874)).toBe(875.5);
  });
  it("uses the height when screenY is below the window", () => {
    // The frame is in a taller coordinate space: the top would be off the window.
    expect(keyboardTopOf(1200, 380, 874)).toBe(494);
  });
  it("uses the height when the frame ends past the window bottom", () => {
    expect(keyboardTopOf(600, 380, 874)).toBe(494);
  });
  it("allows a frame that ends up to 2 points past the window bottom", () => {
    expect(keyboardTopOf(540, 336, 874)).toBe(540);
  });
  it("clamps a keyboard higher than the window", () => {
    expect(keyboardTopOf(0, 1000, 874)).toBe(1);
    expect(keyboardTopOf(300, 1000, 874)).toBe(1);
  });
  it("keeps screenY when the frame does not fit but has no height", () => {
    expect(keyboardTopOf(1200, 0, 874)).toBe(1200);
  });
});

describe("fallbackKeyboardHeight", () => {
  it("uses the last real height", () => {
    expect(fallbackKeyboardHeight(380, 874)).toBe(380);
  });
  it("clamps the last height to the window", () => {
    expect(fallbackKeyboardHeight(1000, 874)).toBe(874);
  });
  it("estimates 42 percent of the window with no real height", () => {
    expect(fallbackKeyboardHeight(undefined, 874)).toBe(367);
    expect(fallbackKeyboardHeight(0, 874)).toBe(367);
  });
});

describe("keyboardOverlap", () => {
  test("a_view_below_a_header_pads_by_the_part_the_keyboard_covers", () => {
    // Screen 874 high, header 116, keyboard 336 high: the view is 116..874, the keyboard top is 538.
    expect(keyboardOverlap(116, 758, 538)).toBe(336);
  });

  test("a_view_at_the_screen_top_pads_by_the_keyboard_height", () => {
    expect(keyboardOverlap(0, 874, 538)).toBe(336);
  });

  test("a_view_that_ends_above_the_keyboard_gets_no_padding", () => {
    expect(keyboardOverlap(100, 300, 538)).toBe(0);
  });

  test("a_keyboard_top_of_zero_is_not_a_position", () => {
    expect(keyboardOverlap(0, 874, 0)).toBe(0);
  });

  test("the_padding_is_a_whole_point", () => {
    expect(keyboardOverlap(116.4, 758, 538)).toBe(336);
  });
});

describe("KeyboardAvoider", () => {
  type Listener = (e: KeyboardEvent) => void;
  let listeners: Record<string, Listener[]>;
  let frame: { y: number; h: number };

  const event = (screenY: number): KeyboardEvent =>
    ({
      duration: 250,
      easing: "keyboard",
      endCoordinates: { screenX: 0, screenY, width: 402, height: 874 - screenY },
    }) as KeyboardEvent;
  const emit = (name: string, e: KeyboardEvent) => act(() => listeners[name]?.forEach((l) => l(e)));
  const padOf = (t: ReactTestRenderer) => {
    const style = [t.root.findByType(View).props.style].flat(Infinity);
    return Object.assign({}, ...style).paddingBottom;
  };
  const render = (atScreenBottom = false) => {
    let t!: ReactTestRenderer;
    act(() => {
      t = create(
        <KeyboardAvoider atScreenBottom={atScreenBottom}>
          <Text>Composer</Text>
        </KeyboardAvoider>,
      );
    });
    // The jest View is a class instance: give it the frame of the view in the window.
    t.root.findByType(View).instance.measureInWindow = (cb: (x: number, y: number, w: number, h: number) => void) =>
      cb(0, frame.y, 402, frame.h);
    return t;
  };

  beforeEach(() => {
    resetKeyboardMemory();
    useDisplayLog.getState().clear();
    listeners = {};
    frame = { y: 116, h: 758 };
    jest.spyOn(Keyboard, "addListener").mockImplementation(((name: string, l: Listener) => {
      (listeners[name] ??= []).push(l);
      return { remove: () => (listeners[name] = listeners[name].filter((x) => x !== l)) };
    }) as never);
  });

  const os = Platform.OS;
  afterEach(() => {
    jest.restoreAllMocks();
    Platform.OS = os;
  });

  test("ios_pads_by_the_covered_part_of_the_view_in_the_window_not_by_the_parent_frame", () => {
    Platform.OS = "ios";
    const t = render();
    expect(padOf(t)).toBe(0);
    emit("keyboardWillChangeFrame", event(538));
    expect(padOf(t)).toBe(336);
    emit("keyboardWillHide", event(874));
    expect(padOf(t)).toBe(0);
  });

  test("ios_measures_again_when_the_keyboard_is_up_because_a_sheet_can_move", () => {
    Platform.OS = "ios";
    frame = { y: 350, h: 524 };
    const t = render();
    emit("keyboardWillChangeFrame", event(538));
    expect(padOf(t)).toBe(336);
    // The sheet moved up to its largest height.
    frame = { y: 62, h: 524 };
    emit("keyboardDidShow", event(538));
    expect(padOf(t)).toBe(48);
  });

  test("android_pads_after_the_keyboard_is_up_and_clears_after_it_is_down", () => {
    Platform.OS = "android";
    const t = render();
    emit("keyboardDidShow", event(538));
    expect(padOf(t)).toBe(336);
    emit("keyboardDidHide", event(874));
    expect(padOf(t)).toBe(0);
  });

  test("a_sheet_at_the_screen_bottom_uses_its_height_not_the_y_that_measure_gives", () => {
    Platform.OS = "ios";
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });
    // A form sheet at its half detent: the native sheet sets its position, so measure gives y = 0.
    frame = { y: 0, h: 500 };
    const t = render(true);
    emit("keyboardWillChangeFrame", event(538));
    expect(padOf(t)).toBe(336);
    // The sheet goes to its largest height: the covered part stays the keyboard height.
    frame = { y: 0, h: 812 };
    emit("keyboardDidShow", event(538));
    expect(padOf(t)).toBe(336);
  });

  const raw = (screenY: number, height: number): KeyboardEvent =>
    ({ duration: 250, easing: "keyboard", endCoordinates: { screenX: 0, screenY, width: 402, height } }) as KeyboardEvent;
  const window874 = () =>
    jest.spyOn(Dimensions, "get").mockReturnValue({ width: 402, height: 874, scale: 3, fontScale: 1 });

  test("ios_pads_by_the_height_when_the_frame_is_below_the_window", () => {
    Platform.OS = "ios";
    window874();
    const t = render();
    emit("keyboardWillChangeFrame", raw(1300, 380));
    expect(padOf(t)).toBe(380);
  });

  test("ios_estimates_the_height_for_a_show_event_with_an_empty_frame", () => {
    Platform.OS = "ios";
    window874();
    const t = render();
    emit("keyboardWillShow", raw(0, 0));
    expect(padOf(t)).toBe(367);
    // A later event with no frame does not take the padding away.
    emit("keyboardWillChangeFrame", raw(0, 0));
    expect(padOf(t)).toBe(367);
    emit("keyboardWillHide", raw(0, 0));
    expect(padOf(t)).toBe(0);
  });

  test("ios_uses_the_last_real_height_for_an_empty_frame", () => {
    Platform.OS = "ios";
    window874();
    const t = render();
    emit("keyboardWillChangeFrame", raw(494, 380));
    emit("keyboardWillHide", raw(874, 380));
    emit("keyboardDidShow", raw(0, 0));
    expect(padOf(t)).toBe(380);
  });

  test("ios_measures_again_with_the_metrics_when_did_show_gives_no_padding", () => {
    Platform.OS = "ios";
    window874();
    jest.spyOn(Keyboard, "isVisible").mockReturnValue(true);
    jest.spyOn(Keyboard, "metrics").mockReturnValue({ screenX: 0, screenY: 494, width: 402, height: 380 });
    const t = render();
    // The event says the keyboard is at the window bottom, but the keyboard is up.
    emit("keyboardDidShow", raw(874, 0));
    expect(padOf(t)).toBe(380);
  });

  test("ios_does_not_measure_again_when_the_keyboard_is_not_visible", () => {
    Platform.OS = "ios";
    window874();
    jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
    const metrics = jest.spyOn(Keyboard, "metrics");
    const t = render();
    emit("keyboardDidShow", raw(874, 0));
    expect(padOf(t)).toBe(0);
    expect(metrics).not.toHaveBeenCalled();
  });

  test("each_keyboard_event_goes_to_the_display_log", () => {
    Platform.OS = "ios";
    window874();
    render();
    emit("keyboardWillChangeFrame", raw(494, 380));
    emit("keyboardWillHide", raw(874, 380));
    const lines = useDisplayLog.getState().events.map((e) => e.text);
    expect(lines[0]).toBe("kb keyboardWillChangeFrame y=494 h=380 win=402x874 scr=402x874 view=116+758 top=494 pad=380");
    expect(lines[1]).toBe("kb keyboardWillHide");
  });

  test("it_stops_listening_when_it_unmounts", () => {
    Platform.OS = "ios";
    const t = render();
    act(() => t.unmount());
    expect(Object.values(listeners).flat()).toHaveLength(0);
  });
});
