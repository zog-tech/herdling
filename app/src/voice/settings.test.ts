jest.mock("@/secureStorage", () => ({
  secureJSONStorage: () => ({ getItem: () => null, setItem: () => {}, removeItem: () => {} }),
}));

import { useVoiceSettings } from "./settings";

test("bluetooth_mic_is_off_by_default", () => {
  expect(useVoiceSettings.getState().bluetoothMic).toBe(false);
});

test("bluetooth_mic_is_persisted", () => {
  const options = useVoiceSettings.persist.getOptions();
  const saved = options.partialize!({ ...useVoiceSettings.getState(), bluetoothMic: true }) as { bluetoothMic?: boolean };
  expect(saved.bluetoothMic).toBe(true);
});
