import * as Device from "expo-device";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

/** The name of this device in running text: "iPhone" on iOS, "phone" on Android. */
export const PHONE = Platform.OS === "android" ? "phone" : "iPhone";
/** The name of this device as a label (a segment, a title): "iPhone" or "Phone". */
export const PHONE_LABEL = Platform.OS === "android" ? "Phone" : "iPhone";

const DEVICE_ID_KEY = "herdling.device_id";

let cached: Promise<string> | undefined;

function newDeviceId(): string {
  let s = "";
  while (s.length < 20) s += Math.random().toString(36).slice(2);
  return `d_${s.slice(0, 20)}`;
}

async function loadOrCreate(): Promise<string> {
  const saved = await SecureStore.getItemAsync(DEVICE_ID_KEY);
  if (saved) return saved;
  const id = newDeviceId();
  await SecureStore.setItemAsync(DEVICE_ID_KEY, id);
  return id;
}

/** This phone's id for the companions, `d_<random>`. Made on first use and kept in the Keychain. */
export function getDeviceId(): Promise<string> {
  if (!cached) {
    cached = loadOrCreate();
    cached.catch(() => {
      cached = undefined;
    });
  }
  return cached;
}

/** The phone's name as the user set it, for the host's device list. */
export function deviceName(): string {
  return Device.deviceName ?? Device.modelName ?? "Phone";
}
