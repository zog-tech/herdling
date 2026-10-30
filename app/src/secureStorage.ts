import * as SecureStore from "expo-secure-store";
import { createJSONStorage, type StateStorage } from "zustand/middleware";

/**
 * Keychain storage for zustand `persist`. A failed write or delete (for example no keychain
 * entitlement, or a locked keychain) logs a warning and is dropped: the in-memory state stays,
 * and the rejection never goes unhandled (zustand drops the promise `setItem` returns).
 * Reads are not caught, so a failed read never looks like empty saved data.
 */
export const secureStateStorage: StateStorage = {
  getItem: (k) => SecureStore.getItemAsync(k),
  setItem: (k, v) =>
    SecureStore.setItemAsync(k, v).catch((e: unknown) => {
      console.warn(`Can't save ${k}: ${e instanceof Error ? e.message : String(e)}`);
    }),
  removeItem: (k) =>
    SecureStore.deleteItemAsync(k).catch((e: unknown) => {
      console.warn(`Can't remove ${k}: ${e instanceof Error ? e.message : String(e)}`);
    }),
};

export const secureJSONStorage = () => createJSONStorage(() => secureStateStorage);
