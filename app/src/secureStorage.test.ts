import * as SecureStore from "expo-secure-store";

import { markSeen, useSeen } from "@/herdr/seen";

import { secureStateStorage } from "./secureStorage";

jest.mock("expo-secure-store", () => ({
  getItemAsync: jest.fn(() => Promise.resolve(null)),
  setItemAsync: jest.fn(() => Promise.reject(new Error("Keychain access failed"))),
  deleteItemAsync: jest.fn(() => Promise.reject(new Error("Keychain access failed"))),
}));

test("failed_keychain_write_warns_and_keeps_memory_state", async () => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  await expect(secureStateStorage.setItem("k", "v")).resolves.toBeUndefined();
  await expect(secureStateStorage.removeItem("k")).resolves.toBeUndefined();
  expect(warn).toHaveBeenCalledWith("Can't save k: Keychain access failed");
  expect(warn).toHaveBeenCalledWith("Can't remove k: Keychain access failed");

  // A persisted store whose write fails keeps the new state in memory.
  markSeen("h1", "p1", 4);
  await Promise.resolve();
  expect(SecureStore.setItemAsync).toHaveBeenCalledWith("herdling.seen", expect.any(String));
  expect(useSeen.getState().seen["h1:p1"]).toBe(4);
  warn.mockRestore();
});
