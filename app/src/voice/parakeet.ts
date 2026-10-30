import { create } from "zustand";

import * as Native from "../../modules/voice/parakeet";
import type { ParakeetModel, ParakeetModelStatus } from "../../modules/voice/parakeet";

/** Download size of each model (Core ML files from FluidAudio's Hugging Face repos). */
export const MODEL_BYTES: Record<ParakeetModel, number> = { v2: 465_000_000, v3: 485_000_000 };

export const MODEL_LABEL: Record<ParakeetModel, string> = {
  v2: "English (Parakeet v2)",
  v3: "Multilingual (Parakeet v3)",
};

type ParakeetState = {
  /** False on builds without FluidAudio: the app hides Parakeet there. */
  available: boolean;
  models: Record<ParakeetModel, ParakeetModelStatus>;
  /** The model that downloads now, and its progress from 0 to 1. */
  downloading?: ParakeetModel;
  progress: number;
  error?: string;
};

const EMPTY: ParakeetModelStatus = { installed: false, bytes: 0, downloading: false };

/** Parakeet model state for Settings and voice input. Not persisted: the files on disk are the truth. */
export const useParakeet = create<ParakeetState>()(() => ({
  available: Native.parakeetAvailable(),
  models: { v2: EMPTY, v3: EMPTY },
  progress: 0,
}));

let listening = false;

function listen() {
  if (listening || !useParakeet.getState().available) return;
  listening = true;
  Native.addParakeetListener(({ model, fraction }) => {
    if (useParakeet.getState().downloading === model) useParakeet.setState({ progress: fraction });
  });
}

/** Reads the installed models from disk. */
export async function refreshParakeet(): Promise<void> {
  if (!useParakeet.getState().available) return;
  listen();
  try {
    useParakeet.setState({ models: await Native.parakeetStatus() });
  } catch {
    // The status stays as it was.
  }
}

const downloadError = (e: unknown): string | undefined => {
  const code = (e as { code?: unknown })?.code;
  if (code === "cancelled") return undefined;
  const message = (e as { message?: unknown })?.message;
  return typeof message === "string" && message ? message : String(e);
};

/** Downloads `model`. Resolves true when it is installed. Errors go to `error`. */
export async function downloadParakeet(model: ParakeetModel, allowCellular: boolean): Promise<boolean> {
  if (!useParakeet.getState().available || useParakeet.getState().downloading) return false;
  listen();
  useParakeet.setState({ downloading: model, progress: 0, error: undefined });
  try {
    await Native.downloadParakeet(model, { allowCellular });
    return true;
  } catch (e) {
    useParakeet.setState({ error: downloadError(e) });
    return false;
  } finally {
    useParakeet.setState({ downloading: undefined });
    await refreshParakeet();
  }
}

export function cancelParakeetDownload(): void {
  void Native.cancelParakeetDownload().catch(() => {});
}

export async function deleteParakeet(model: ParakeetModel): Promise<void> {
  await Native.deleteParakeet(model).catch(() => {});
  await refreshParakeet();
}

/** True when `model` is installed and this build can run it. */
export function parakeetReady(s: ParakeetState, model: ParakeetModel): boolean {
  return s.available && s.models[model].installed;
}

/** "465 MB". */
export function formatBytes(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)} GB`;
  return `${Math.max(1, Math.round(n / 1_000_000))} MB`;
}
