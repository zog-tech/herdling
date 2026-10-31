import * as ImagePicker from "expo-image-picker";

import * as DocumentPicker from "expo-document-picker";

import type { RpcClient } from "@/rpc/RpcClient";

import {
  documentsAvailable,
  fileRoom,
  formatBytes,
  jpegName,
  MAX_ATTACHMENTS,
  MAX_FILE_BYTES,
  photoRoom,
  photosAvailable,
  pickFiles,
  pickPhotos,
  uploadPhotos,
  withPaths,
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
