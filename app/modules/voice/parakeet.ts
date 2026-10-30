import { requireOptionalNativeModule, type NativeModule } from "expo";

/** "v2": English, best recall. "v3": 25 European languages. */
export type ParakeetModel = "v2" | "v3";

export type ParakeetModelStatus = { installed: boolean; bytes: number; downloading: boolean };

type ParakeetEvents = {
  /** Model download progress, 0 to 1. */
  onModelProgress: (e: { model: ParakeetModel; fraction: number }) => void;
};

declare class ParakeetNativeModule extends NativeModule<ParakeetEvents> {
  status(): Promise<Record<ParakeetModel, ParakeetModelStatus>>;
  download(model: ParakeetModel, o: { allowCellular: boolean }): Promise<void>;
  cancelDownload(): Promise<void>;
  remove(model: ParakeetModel): Promise<void>;
  transcribe(uri: string, model: ParakeetModel): Promise<string>;
}

/**
 * Parakeet (FluidAudio) on the device. The native code is in the ssh pod (see
 * ParakeetModule.swift). Builds before file recording (build 5) do not have the module:
 * every call here checks it first, so an OTA update never calls a native function that is not there.
 */
const Native = requireOptionalNativeModule<ParakeetNativeModule>("ParakeetModule");

const missing = () => Promise.reject(Object.assign(new Error("This build has no Parakeet"), { code: "unavailable" }));

const NO_MODELS: Record<ParakeetModel, ParakeetModelStatus> = {
  v2: { installed: false, bytes: 0, downloading: false },
  v3: { installed: false, bytes: 0, downloading: false },
};

/** True when this binary has Parakeet. */
export function parakeetAvailable(): boolean {
  return Native != null;
}

/** Installed state and size on disk of each model. Nothing is installed on older builds. */
export function parakeetStatus(): Promise<Record<ParakeetModel, ParakeetModelStatus>> {
  return Native ? Native.status() : Promise.resolve(NO_MODELS);
}

/**
 * Downloads a model. Progress comes as `onModelProgress`. Without `allowCellular` it runs on
 * Wi-Fi only. Rejects with "busy", "offline", "cellular", "cancelled" or "download_failed".
 */
export function downloadParakeet(model: ParakeetModel, o: { allowCellular: boolean }): Promise<void> {
  return Native ? Native.download(model, o) : missing();
}

/** Stops a running model download. */
export function cancelParakeetDownload(): Promise<void> {
  return Native ? Native.cancelDownload() : Promise.resolve();
}

/** Deletes a downloaded model. */
export function deleteParakeet(model: ParakeetModel): Promise<void> {
  return Native ? Native.remove(model) : Promise.resolve();
}

/** Transcribes a WAV recording with `model`. Rejects with "not_installed" or "failed". */
export function transcribeParakeet(uri: string, model: ParakeetModel): Promise<string> {
  return Native ? Native.transcribe(uri, model) : missing();
}

/** Listens for download progress. Does nothing on older builds. */
export function addParakeetListener(listener: ParakeetEvents["onModelProgress"]): { remove(): void } {
  return Native ? Native.addListener("onModelProgress", listener) : { remove() {} };
}
