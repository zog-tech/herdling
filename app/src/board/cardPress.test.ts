import { motion } from "@/theme/tokens";

import * as haptics from "@/ui/haptics";

import { cardActions, makeCardPress } from "./cardPress";

jest.mock("@/ui/haptics", () => ({ press: jest.fn(), peek: jest.fn() }));

const values = () => ({ scale: { set: jest.fn() }, overlay: { set: jest.fn() } });

test("tap_and_long_press_run_their_own_action", () => {
  const onTap = jest.fn();
  const onLong = jest.fn();
  const p = makeCardPress(values(), false, onTap, onLong);
  p.tap();
  expect(onTap).toHaveBeenCalledTimes(1);
  expect(onLong).not.toHaveBeenCalled();
  p.long();
  expect(onLong).toHaveBeenCalledTimes(1);
  expect(onTap).toHaveBeenCalledTimes(1);
});

test("press_scales_down_toward_the_hold_scale_and_release_springs_back", () => {
  const v = values();
  const p = makeCardPress(v, false, jest.fn(), jest.fn());
  p.begin();
  // The test stand-in of withSequence returns its last step: the hold scale.
  expect(v.scale.set).toHaveBeenLastCalledWith(motion.press.holdScale);
  expect(v.overlay.set).toHaveBeenLastCalledWith(motion.press.overlay);
  p.release();
  expect(v.scale.set).toHaveBeenLastCalledWith(1);
  expect(v.overlay.set).toHaveBeenLastCalledWith(0);
});

test("reduce_motion_keeps_the_layer_but_never_scales", () => {
  const v = values();
  const p = makeCardPress(v, true, jest.fn(), jest.fn());
  p.begin();
  p.release();
  expect(v.scale.set).not.toHaveBeenCalled();
  expect(v.overlay.set).toHaveBeenCalledTimes(2);
});

test("open_gives_a_light_haptic_and_peek_a_medium_one", () => {
  const onOpen = jest.fn();
  const onPeek = jest.fn();
  const a = cardActions("card-1", onOpen, onPeek);
  a.peek();
  expect(haptics.peek).toHaveBeenCalledTimes(1);
  expect(onPeek).toHaveBeenCalledWith("card-1");
  expect(haptics.press).not.toHaveBeenCalled();
  a.open();
  expect(haptics.press).toHaveBeenCalledTimes(1);
  expect(onOpen).toHaveBeenCalledWith("card-1");
});
