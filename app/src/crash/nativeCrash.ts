/**
 * Moves a saved native crash into the crash log at launch. The native module writes the crash file
 * when an uncaught native exception stops the app; JS cannot run at that time, so the next launch
 * reads the file, adds a "native" entry and deletes the file.
 */
import { clearNativeCrash, readNativeCrash, type NativeCrash } from "../../modules/crash";

import { appendEntry, nativeEntry } from "./crashLog";

export type NativeCrashSource = {
  read: () => Promise<NativeCrash | null>;
  clear: () => Promise<void>;
};

const nativeSource: NativeCrashSource = { read: readNativeCrash, clear: clearNativeCrash };

/**
 * Adds the saved native crash to the crash log and deletes the file. True when it added an entry.
 * It never throws. On a build without the native module, `read` gives null and nothing happens.
 */
export async function importNativeCrash(source: NativeCrashSource = nativeSource): Promise<boolean> {
  try {
    const crash = await source.read();
    if (!crash) return false;
    appendEntry(nativeEntry(crash.at, crash.text));
    await source.clear();
    return true;
  } catch {
    return false;
  }
}
