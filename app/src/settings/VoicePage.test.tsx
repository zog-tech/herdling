import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useMenuSheet } from "@/ui/MenuSheet";
import { useVoiceSettings } from "@/voice/settings";

import { VoicePage } from "./VoicePage";

jest.mock("@/secureStorage", () => {
  const { createJSONStorage } = jest.requireActual("zustand/middleware");
  const mem = new Map<string, string>();
  return {
    secureJSONStorage: () =>
      createJSONStorage(() => ({
        getItem: (k: string) => mem.get(k) ?? null,
        setItem: (k: string, v: string) => void mem.set(k, v),
        removeItem: (k: string) => void mem.delete(k),
      })),
  };
});
jest.mock("expo-secure-store", () => ({
  getItem: jest.fn(() => null),
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.resolve()),
  deleteItemAsync: jest.fn(() => Promise.resolve()),
}));
jest.mock("expo-speech", () => ({
  getAvailableVoicesAsync: jest.fn(() =>
    Promise.resolve([
      { identifier: "flo-gb", name: "Flo", language: "en-GB", quality: "Enhanced" },
      { identifier: "sam-us", name: "Sam", language: "en-US", quality: "Default" },
    ]),
  ),
}));
jest.mock("@/voice/useSpeakReplies", () => ({ testVoice: jest.fn() }));
jest.mock("@/voice/VoiceInputSettings", () => ({ VoiceInputSection: () => null }));
jest.mock("@/hosts/store", () => ({ useHosts: (sel: (s: { hosts: { id: string }[] }) => unknown) => sel({ hosts: [{ id: "h1" }] }) }));
jest.mock("@/ui/haptics", () => ({ tap: jest.fn(), press: jest.fn() }));
jest.mock("react-native-safe-area-context", () => ({ useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }) }));

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

async function render() {
  await act(async () => {
    tree = create(<VoicePage />);
  });
  return tree!;
}
const byLabel = (t: ReactTestRenderer, label: string) =>
  t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");

test("the_voice_row_opens_a_picker_with_search_and_a_pick_stores_the_voice", async () => {
  useVoiceSettings.getState().set({ voice: undefined });
  const t = await render();
  expect(byLabel(t, "Voice").props.accessibilityValue).toEqual({ text: "System default" });
  act(() => byLabel(t, "Voice").props.onPress());
  const st = useMenuSheet.getState().state;
  if (st.kind !== "open") throw new Error("the picker did not open");
  expect(st.menu.search).toBeDefined();
  const items = st.menu.sections.flatMap((s) => s.items);
  // "System default" first; the device voices follow in the order of `deviceVoices` (region first).
  expect(items[0].label).toBe("System default");
  expect(items.map((i) => i.label).sort()).toEqual(["Flo · UK", "Sam · US", "System default"]);
  expect(items[0].checked).toBe(true);
  act(() => items.find((i) => i.label === "Sam · US")!.onPick());
  expect(useVoiceSettings.getState().voice).toBe("sam-us");
  expect(byLabel(t, "Voice").props.accessibilityValue).toEqual({ text: "Sam · US" });
});

test("system_default_stores_no_voice", async () => {
  useVoiceSettings.getState().set({ voice: "flo-gb" });
  const t = await render();
  act(() => byLabel(t, "Voice").props.onPress());
  const st = useMenuSheet.getState().state;
  if (st.kind !== "open") throw new Error("the picker did not open");
  act(() => st.menu.sections[0].items[0].onPick());
  expect(useVoiceSettings.getState().voice).toBeUndefined();
});

test("the_speed_steps_stay_in_range", async () => {
  useVoiceSettings.getState().set({ rate: 2 });
  const t = await render();
  expect(byLabel(t, "Faster").props.accessibilityState).toMatchObject({ disabled: true });
  act(() => byLabel(t, "Slower").props.onPress());
  expect(useVoiceSettings.getState().rate).toBe(1.9);
});
