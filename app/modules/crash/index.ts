/**
 * Native crash capture. The native module saves an uncaught NSException (iOS) or an uncaught
 * throwable (Android) to a small file. The next launch reads it here and adds it to the crash log.
 */
import { NativeModule, requireOptionalNativeModule } from "expo";

declare class CrashNativeModule extends NativeModule<Record<never, never>> {
  read(): Promise<string | null>;
  clear(): Promise<void>;
}

// Build 6 and older builds do not have this module. An OTA update must not crash them.
const Crash = requireOptionalNativeModule<CrashNativeModule>("HerdlingCrash");

/** True when this build saves native crashes. */
export const hasNativeCrashCapture = Crash != null;

/** A saved native crash: the time in epoch ms and the text (the headline, then the stack). */
export type NativeCrash = { at: number; text: string };

/**
 * The crash in the file text. Line 1 is the time in epoch ms, the other lines are the text.
 * An empty or damaged file gives null.
 */
export function parseNativeCrash(raw: string | null | undefined): NativeCrash | null {
  if (!raw) return null;
  const nl = raw.indexOf("\n");
  const at = Number(nl < 0 ? raw : raw.slice(0, nl));
  const text = nl < 0 ? "" : raw.slice(nl + 1).trim();
  if (!text) return null;
  return { at: Number.isFinite(at) && at > 0 ? at : Date.now(), text };
}

/** The saved native crash, or null: no crash, no native module (an older build) or a failed read. */
export async function readNativeCrash(): Promise<NativeCrash | null> {
  if (!Crash) return null;
  try {
    return parseNativeCrash(await Crash.read());
  } catch {
    return null;
  }
}

/** Deletes the saved native crash. Does nothing on an older build. */
export async function clearNativeCrash(): Promise<void> {
  if (!Crash) return;
  try {
    await Crash.clear();
  } catch {
    // Nothing to do: the next launch reads the same crash again.
  }
}
