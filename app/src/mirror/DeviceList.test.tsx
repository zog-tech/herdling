import type { DevicesList } from "@herdling/protocol";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { DeviceList } from "./DeviceList";

const list: DevicesList = {
  devices: [
    { id: "android:emulator-5554", platform: "android", kind: "emulator", name: "Pixel 8", os: "Android 15", video: true, input: true },
    { id: "android:192.0.2.1:5555", platform: "android", kind: "device", name: "TV", video: true, input: true },
    { id: "ios:269EBED9-ADE0-4AF4-9067-6B649B12BCCB", platform: "ios", kind: "simulator", name: "iPhone 17", os: "iOS 26.5", video: false, input: false },
  ],
  tools: { xcrun: true, idb: false, adb: true },
};

const texts = (t: ReactTestRenderer) =>
  t.root.findAll((n) => (n.type as unknown) === "Text").map((n) => [n.props.children].flat().join(""));

test("device_list_shows_simulators_and_emulators_and_opens_one", () => {
  const open = jest.fn();
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<DeviceList list={list} macos onOpen={open} />);
  });
  const shown = texts(t);
  expect(shown).toEqual(expect.arrayContaining(["iPhone 17", "Pixel 8", "iOS 26.5 · Screenshots, view only", "Android 15 · Video and touch"]));
  // The real device is not offered; a note says so.
  expect(shown).not.toContain("TV");
  expect(shown.some((s) => /1 real device is not shown/.test(s))).toBe(true);
  expect(shown.some((s) => /Install idb/.test(s))).toBe(true);
  const row = t.root.find((n) => typeof n.props.accessibilityLabel === "string" && n.props.accessibilityLabel.startsWith("Pixel 8") && !!n.props.onPress);
  act(() => row.props.onPress());
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: "android:emulator-5554" }));
  act(() => t.unmount());
});

test("device_list_says_when_nothing_runs", () => {
  let t!: ReactTestRenderer;
  act(() => {
    t = create(<DeviceList list={{ devices: [], tools: { xcrun: true, idb: true, adb: true } }} macos onOpen={() => {}} />);
  });
  expect(texts(t).some((s) => /^No booted simulator/.test(s))).toBe(true);
  act(() => t.unmount());
});
