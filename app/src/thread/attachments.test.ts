import * as ImagePicker from "expo-image-picker";

import * as DocumentPicker from "expo-document-picker";

import { Keyboard } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";
import { useDisplayLog } from "@/ui/displayLog";

import {
  documentsAvailable,
  fileRoom,
  formatBytes,
  isPresenterError,
  jpegName,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  photoRoom,
  photosAvailable,
  pickFiles,
  pickPhotos,
  PRESENTER_HELP,
  PRESENTER_RETRY_MS,
  PresenterError,
  uploadPhotos,
  withPaths,
  withPresenterRetry,
  type Attachment,
} from "./attachments";

const mockOptional = jest.fn((_name: string): unknown => ({}));
jest.mock("expo", () => ({ requireOptionalNativeModule: (n: string) => mockOptional(n) }));

jest.mock("expo-document-picker", () => ({ getDocumentAsync: jest.fn() }));

jest.mock("expo-image-picker", () => ({
  launchImageLibraryAsync: jest.fn(),
  UIImagePickerPreferredAssetRepresentationMode: { Compatible: "compatible" },
}));

test("with_paths_puts_each_path_on_its_own_line", () => {
  expect(withPaths("Fix this  \n", ["/a.jpg", "/b.jpg"])).toBe("Fix this\n/a.jpg\n/b.jpg");
  expect(withPaths("", ["/a.jpg"])).toBe("/a.jpg");
  expect(withPaths("text", [])).toBe("text");
});

test("jpeg_name_replaces_the_extension", () => {
  expect(jpegName("IMG_0001.HEIC", 0)).toBe("IMG_0001.jpg");
  expect(jpegName("shot", 0)).toBe("shot.jpg");
  expect(jpegName(null, 2)).toBe("photo-3.jpg");
  expect(jpegName(".HEIC", 0)).toBe("photo-1.jpg");
});

test("pick_photos_returns_nothing_on_cancel_and_skips_assets_without_data", async () => {
  const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
  launch.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await pickPhotos(4)).toEqual([]);

  launch.mockResolvedValueOnce({
    canceled: false,
    assets: [
      { uri: "file:///a", fileName: "a.png", base64: "AAA" },
      { uri: "file:///b", fileName: "b.png", base64: null },
    ],
  });
  expect(await pickPhotos(2)).toEqual([{ uri: "file:///a", name: "a.jpg", base64: "AAA" }]);
  expect(launch).toHaveBeenLastCalledWith(expect.objectContaining({ selectionLimit: 2 }));

  launch.mockClear();
  expect(await pickPhotos(0)).toEqual([]);
  expect(launch).not.toHaveBeenCalled();
});

test("a_binary_without_the_picker_has_no_photos_and_never_opens_it", async () => {
  mockOptional.mockReturnValueOnce(null).mockReturnValueOnce(null);
  expect(photosAvailable()).toBe(false);
  const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
  launch.mockClear();
  expect(await pickPhotos(4)).toEqual([]);
  expect(launch).not.toHaveBeenCalled();
});

test("a_binary_without_the_document_picker_hides_files_and_never_opens_it", async () => {
  mockOptional.mockReturnValueOnce(null).mockReturnValueOnce(null);
  expect(documentsAvailable()).toBe(false);
  const get = DocumentPicker.getDocumentAsync as jest.Mock;
  get.mockClear();
  expect(await pickFiles(4)).toEqual({ files: [], tooLarge: [] });
  expect(get).not.toHaveBeenCalled();
  expect(mockOptional).toHaveBeenCalledWith("ExpoDocumentPicker");
});

test("pick_files_keeps_any_type_and_leaves_out_too_large_files", async () => {
  const get = DocumentPicker.getDocumentAsync as jest.Mock;
  get.mockResolvedValueOnce({ canceled: true, assets: null });
  expect(await pickFiles(4)).toEqual({ files: [], tooLarge: [] });

  get.mockResolvedValueOnce({
    canceled: false,
    assets: [
      { uri: "file:///notes.md", name: "notes.md", size: 120, mimeType: "text/markdown", lastModified: 0 },
      { uri: "file:///big.zip", name: "big.zip", size: MAX_FILE_BYTES + 1, mimeType: "application/zip", lastModified: 0 },
      { uri: "file:///report.pdf", name: "report.pdf", size: 2048, mimeType: "application/pdf", lastModified: 0 },
      { uri: "file:///x.log", name: "x.log", lastModified: 0 },
    ],
  });
  const r = await pickFiles(2);
  expect(r.tooLarge).toEqual(["big.zip"]);
  expect(r.files).toEqual([
    { kind: "file", uri: "file:///notes.md", name: "notes.md", size: 120, mime: "text/markdown" },
    { kind: "file", uri: "file:///report.pdf", name: "report.pdf", size: 2048, mime: "application/pdf" },
  ]);
  expect(get).toHaveBeenLastCalledWith(expect.objectContaining({ type: "*/*", multiple: true }));
  get.mockClear();
  expect(await pickFiles(0)).toEqual({ files: [], tooLarge: [] });
  expect(get).not.toHaveBeenCalled();
});

test("upload_sends_photos_and_files_in_order", async () => {
  const calls: { name: string; data_b64: string }[] = [];
  const rpc = {
    call: jest.fn(async (_m: string, p: { name: string; data_b64: string }) => {
      calls.push(p);
      return { path: `/up/${p.name}` };
    }),
  } as unknown as RpcClient;
  const items: Attachment[] = [
    { uri: "file:///a", name: "a.jpg", base64: "QQ==" },
    { kind: "file", uri: "file:///b.csv", name: "b.csv", size: 3 },
  ];
  const done: number[] = [];
  const read = jest.fn(async (uri: string) => (uri === "file:///b.csv" ? "YSxi" : ""));
  const paths = await uploadPhotos(rpc, items, (n) => done.push(n), read);
  expect(paths).toEqual(["/up/a.jpg", "/up/b.csv"]);
  expect(calls).toEqual([
    { name: "a.jpg", data_b64: "QQ==" },
    { name: "b.csv", data_b64: "YSxi" },
  ]);
  expect(read).toHaveBeenCalledTimes(1);
  expect(done).toEqual([1, 2]);
});

test("room_for_photos_and_files", () => {
  const photo: Attachment = { uri: "u", name: "p.jpg", base64: "" };
  const file: Attachment = { kind: "file", uri: "f", name: "f.txt" };
  expect(photoRoom([])).toBe(4);
  expect(photoRoom([photo, photo, photo, photo])).toBe(0);
  expect(photoRoom([file, file, file])).toBe(3);
  expect(photoRoom([file, file, file, file, file])).toBe(1);
  expect(fileRoom([photo, photo, photo, photo])).toBe(MAX_ATTACHMENTS - 4);
  expect(fileRoom(Array(MAX_ATTACHMENTS).fill(file))).toBe(0);
});

test("format_bytes", () => {
  expect(formatBytes(512)).toBe("512 B");
  expect(formatBytes(12 * 1024)).toBe("12 KB");
  expect(formatBytes(3.4 * 1024 * 1024)).toBe("3.4 MB");
  expect(formatBytes(MAX_FILE_BYTES)).toBe("25.0 MB");
});

describe("picker retry when no view controller is found", () => {
  const presenterError = () =>
    new Error("Calling the 'launchImageLibraryAsync' function has failed\n→ Caused by: Cannot determine currently presented view controller");

  beforeEach(() => useDisplayLog.getState().clear());

  test("is_presenter_error_knows_both_picker_messages_and_codes", () => {
    expect(isPresenterError(presenterError())).toBe(true);
    expect(isPresenterError(new Error("Could not find the current ViewController"))).toBe(true);
    expect(isPresenterError(Object.assign(new Error("x"), { code: "ERR_MISSING_CURRENT_VIEW_CONTROLLER" }))).toBe(true);
    expect(isPresenterError(new Error("Permission denied"))).toBe(false);
  });

  test("pick_photos_closes_the_keyboard_and_tries_again_once", async () => {
    const dismiss = jest.spyOn(Keyboard, "dismiss");
    const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
    launch.mockClear();
    launch.mockRejectedValueOnce(presenterError()).mockResolvedValueOnce({
      canceled: false,
      assets: [{ uri: "file:///a", fileName: "a.png", base64: "AAA" }],
    });
    expect(await pickPhotos(4)).toEqual([{ uri: "file:///a", name: "a.jpg", base64: "AAA" }]);
    expect(launch).toHaveBeenCalledTimes(2);
    expect(dismiss).toHaveBeenCalled();
    expect(useDisplayLog.getState().events.map((e) => e.text)[0]).toMatch(/^picker photos failed, try 1: .*presented view controller/);
    dismiss.mockRestore();
  });

  test("a_second_failure_gives_the_airplay_help", async () => {
    const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
    launch.mockClear();
    launch.mockRejectedValueOnce(presenterError()).mockRejectedValueOnce(presenterError());
    const err = await pickPhotos(4).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(PresenterError);
    expect((err as Error).message).toBe(PRESENTER_HELP.photos);
    expect(useDisplayLog.getState().events).toHaveLength(2);
  });

  test("pick_files_tries_again_too", async () => {
    const get = DocumentPicker.getDocumentAsync as jest.Mock;
    get.mockClear();
    get.mockRejectedValueOnce(new Error("Could not find the current ViewController")).mockResolvedValueOnce({ canceled: true, assets: null });
    expect(await pickFiles(4)).toEqual({ files: [], tooLarge: [] });
    expect(get).toHaveBeenCalledTimes(2);
  });

  test("other_errors_are_not_tried_again", async () => {
    const wait = jest.fn(async () => {});
    const open = jest.fn(async () => {
      throw new Error("Permission denied");
    });
    await expect(withPresenterRetry("photos", open, wait)).rejects.toThrow("Permission denied");
    expect(open).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(useDisplayLog.getState().events.map((e) => e.text)).toEqual(["picker photos failed, try 1: Permission denied"]);
  });

  test("it_waits_before_the_second_try", async () => {
    const wait = jest.fn(async () => {});
    const open = jest.fn().mockRejectedValueOnce(presenterError()).mockResolvedValueOnce("ok");
    await expect(withPresenterRetry("files", open, wait)).resolves.toBe("ok");
    expect(wait).toHaveBeenCalledWith(PRESENTER_RETRY_MS);
  });
});
