// Reanimated and Worklets need the native runtime, and their own mocks load it too.
// Tests use this small stand-in: animations jump to their end value at once.
jest.mock("react-native-reanimated", () => {
  const RN = jest.requireActual("react-native");
  const sv = (init) => {
    let v = init;
    return { get: () => v, set: (n) => (v = typeof n === "function" ? n(v) : n), value: init };
  };
  const last = (...a) => a[a.length - 1];
  const Animated = { View: RN.View, Text: RN.Text, ScrollView: RN.ScrollView, createAnimatedComponent: (c) => c };
  return {
    __esModule: true,
    default: Animated,
    ...Animated,
    useSharedValue: (init) => require("react").useState(() => sv(init))[0],
    useAnimatedStyle: (fn) => fn(),
    useDerivedValue: (fn) => sv(fn()),
    useAnimatedReaction: () => {},
    useReducedMotion: () => false,
    withTiming: (v) => v,
    withSpring: (v) => v,
    withDelay: (_d, v) => v,
    withSequence: last,
    withRepeat: (v) => v,
    cancelAnimation: () => {},
    // Gesture Handler reads these; in tests no value is shared and no event goes to the UI thread.
    isSharedValue: () => false,
    useEvent: () => () => {},
    useHandler: () => ({ context: {}, doDependenciesDiffer: false }),
    useComposedEventHandler: () => () => {},
    cubicBezier: () => "ease",
    Easing: { bezier: () => (t) => t, linear: (t) => t, out: (f) => f, inOut: (f) => f },
    ReduceMotion: { System: "system", Always: "always", Never: "never" },
  };
});
jest.mock("react-native-worklets", () => ({ scheduleOnRN: (fn, ...args) => fn(...args), scheduleOnUI: (fn, ...args) => fn(...args) }));
