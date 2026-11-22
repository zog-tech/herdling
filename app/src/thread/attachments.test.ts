import * as ImagePicker from "expo-image-picker";

import * as DocumentPicker from "expo-document-picker";

import { Keyboard } from "react-native";

import type { RpcClient } from "@/rpc/RpcClient";
import { useDisplayLog } from "@/ui/displayLog";

import {
  bytesToBase64,
  canChunk,
  CHUNK_BYTES,
  documentsAvailable,
  formatDuration,
  fromPastedVideo,
  MAX_VIDEO_BYTES,
  pathLines,
  pickMedia,
  planChunks,
  splitTooLarge,
  tooLargeVideoText,
  UploadCanceled,
  uploadLabel,
  uploadRoute,
  uploadVideo,
  VIDEO_NOTE,
  videoCaption,
  videoLimit,
  videoName,
  type FileReader,
  type Video,
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
  VideoExportPreset: { H264_1920x1080: 7 },
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

describe("videos", () => {
  const video = (over: Partial<Video> = {}): Video => ({ kind: "video", uri: "file:///clip.mp4", name: "clip.mp4", ...over });
  const hello = (methods?: string[]) => ({ host: "h", os: "linux" as const, herdlingd: "1", herdr_ok: true, methods });

  test("plan_chunks_covers_the_file_in_order", () => {
    expect(planChunks(0, 4)).toEqual([]);
    expect(planChunks(3, 4)).toEqual([{ offset: 0, length: 3 }]);
    expect(planChunks(8, 4)).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
    ]);
    expect(planChunks(10, 4)).toEqual([
      { offset: 0, length: 4 },
      { offset: 4, length: 4 },
      { offset: 8, length: 2 },
    ]);
    const big = planChunks(MAX_VIDEO_BYTES, CHUNK_BYTES);
    expect(big).toHaveLength(125);
    expect(big.reduce((n, c) => n + c.length, 0)).toBe(MAX_VIDEO_BYTES);
  });

  test("the_route_and_the_limit_follow_the_host", () => {
    expect(canChunk(hello(["files.put", "files.put_begin"]))).toBe(true);
    expect(canChunk(hello(["files.put"]))).toBe(false);
    // An older herdlingd that does not list its methods: one files.put call.
    expect(canChunk(hello(undefined))).toBe(false);
    expect(canChunk(undefined)).toBe(false);
    expect(uploadRoute(video(), true)).toBe("chunked");
    expect(uploadRoute(video(), false)).toBe("single");
    expect(uploadRoute({ kind: "file", uri: "f", name: "f.zip" }, true)).toBe("single");
    expect(uploadRoute({ uri: "u", name: "p.jpg", base64: "" }, true)).toBe("single");
    expect(videoLimit(true)).toBe(500 * 1024 * 1024);
    expect(videoLimit(false)).toBe(MAX_FILE_BYTES);
  });

  test("too_large_videos_are_named_with_a_hint_on_an_older_host", () => {
    const items: Attachment[] = [video({ name: "a.mp4", size: 30 << 20 }), video({ name: "b.mp4" }), { kind: "file", uri: "f", name: "f.zip", size: 1 << 30 }];
    const old = splitTooLarge(items, videoLimit(false));
    expect(old.tooLarge).toEqual(["a.mp4"]);
    expect(old.fit.map((a) => a.name)).toEqual(["b.mp4", "f.zip"]);
    expect(splitTooLarge(items, videoLimit(true)).tooLarge).toEqual([]);
    expect(tooLargeVideoText(["a.mp4"], false)).toBe("Too large to attach (max 25.0 MB): a.mp4. Update herdlingd for videos up to 500.0 MB.");
    expect(tooLargeVideoText(["a.mp4", "c.mov"], true)).toBe("Too large to attach (max 500.0 MB): a.mp4, c.mov");
  });

  test("captions_and_names", () => {
    expect(formatDuration(0)).toBe("0:00");
    expect(formatDuration(42_400)).toBe("0:42");
    expect(formatDuration(725_000)).toBe("12:05");
    expect(formatDuration(3_723_000)).toBe("1:02:03");
    expect(videoCaption({ duration: 42_000, size: 3.4 * 1024 * 1024 })).toBe("0:42 · 3.4 MB");
    expect(videoCaption({ size: 512 })).toBe("512 B");
    expect(videoCaption({})).toBe("");
    expect(videoName("IMG_0007.MOV", "file:///cache/ABC.mp4", 0)).toBe("IMG_0007.mp4");
    expect(videoName(null, "file:///cache/ABC.MOV", 1)).toBe("video-2.mov");
    expect(videoName(undefined, "content://media/42", 0)).toBe("video-1.mp4");
    expect(uploadLabel({ index: 0, total: 2, fraction: 0.345 })).toBe("Uploading 1 of 2 · 34%");
    expect(uploadLabel({ index: 1, total: 2, fraction: 1 })).toBe("Uploading 2 of 2 · 100%");
  });

  test("a_video_path_comes_after_the_note", () => {
    const items: Attachment[] = [{ uri: "u", name: "p.jpg", base64: "" }, video()];
    expect(pathLines(items, ["/up/p.jpg", "/up/clip.mp4"])).toEqual(["/up/p.jpg", VIDEO_NOTE, "/up/clip.mp4"]);
    expect(withPaths("look", pathLines(items, ["/up/p.jpg", "/up/clip.mp4"]))).toBe(`look\n/up/p.jpg\n${VIDEO_NOTE}\n/up/clip.mp4`);
    expect(VIDEO_NOTE).toMatch(/video/);
    expect(VIDEO_NOTE).toMatch(/ffmpeg/);
    expect(VIDEO_NOTE.length).toBeLessThan(100);
  });

  test("bytes_to_base64_matches_node", () => {
    for (const n of [0, 1, 2, 3, 4, 5, 100, 70_000]) {
      const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) & 255);
      expect(bytesToBase64(bytes)).toBe(Buffer.from(bytes).toString("base64"));
    }
  });

  /** A file of `size` bytes; byte i is i & 255. */
  const fakeFile = (size: number): FileReader & { closed: number } => {
    const f = {
      closed: 0,
      size: async () => size,
      open: async () => {
        let at = 0;
        return {
          read: async (n: number) => {
            const out = new Uint8Array(Math.min(n, size - at)).map((_, i) => (at + i) & 255);
            at += out.length;
            return bytesToBase64(out);
          },
          close: () => {
            f.closed += 1;
          },
        };
      },
    };
    return f;
  };
  const chunkRpc = (fail?: (method: string, p: { offset?: number }) => boolean) => {
    const calls: { method: string; params: Record<string, unknown> }[] = [];
    const rpc = {
      call: jest.fn(async (method: string, params: Record<string, unknown>) => {
        calls.push({ method, params });
        if (fail?.(method, params)) throw Object.assign(new Error("disk full"), { code: "io_error" });
        if (method === "files.put_begin") return { upload_id: "u1", chunk_bytes: 4 };
        if (method === "files.put_chunk") return { received: 0 };
        if (method === "files.put_end") return { path: "/up/clip.mp4" };
        if (method === "files.put") return { path: `/up/${params.name}` };
        return {};
      }),
    } as unknown as RpcClient;
    return { rpc, calls };
  };

  test("upload_video_sends_the_parts_in_order_and_reports_progress", async () => {
    const { rpc, calls } = chunkRpc();
    const file = fakeFile(10);
    const fractions: number[] = [];
    const path = await uploadVideo(rpc, video(), (f) => fractions.push(f), undefined, file);
    expect(path).toBe("/up/clip.mp4");
    expect(calls.map((c) => c.method)).toEqual(["files.put_begin", "files.put_chunk", "files.put_chunk", "files.put_chunk", "files.put_end"]);
    expect(calls[0].params).toEqual({ name: "clip.mp4", size: 10 });
    const parts = calls.filter((c) => c.method === "files.put_chunk").map((c) => c.params);
    expect(parts.map((p) => p.offset)).toEqual([0, 4, 8]);
    expect(Buffer.concat(parts.map((p) => Buffer.from(p.data_b64 as string, "base64")))).toEqual(Buffer.from(Array.from({ length: 10 }, (_, i) => i)));
    expect(parts.every((p) => p.upload_id === "u1")).toBe(true);
    expect(fractions).toEqual([0.4, 0.8, 1]);
    expect(file.closed).toBe(1);
  });

  test("a_failed_part_aborts_the_upload_and_throws", async () => {
    const { rpc, calls } = chunkRpc((m, p) => m === "files.put_chunk" && p.offset === 4);
    const file = fakeFile(10);
    await expect(uploadVideo(rpc, video(), () => {}, undefined, file)).rejects.toThrow("disk full");
    expect(calls.map((c) => c.method)).toEqual(["files.put_begin", "files.put_chunk", "files.put_chunk", "files.put_abort"]);
    expect(calls[3].params).toEqual({ upload_id: "u1" });
    expect(file.closed).toBe(1);
  });

  test("a_cancel_stops_between_parts_and_aborts", async () => {
    const { rpc, calls } = chunkRpc();
    const signal = { aborted: false };
    const items = [video()];
    const p = uploadPhotos(rpc, items, undefined, undefined, {
      chunked: true,
      files: fakeFile(10),
      signal,
      onProgress: (pr) => {
        if (pr.fraction > 0) signal.aborted = true;
      },
    });
    await expect(p).rejects.toBeInstanceOf(UploadCanceled);
    expect(calls.map((c) => c.method)).toEqual(["files.put_begin", "files.put_chunk", "files.put_abort"]);
  });

  test("a_video_larger_than_the_limit_is_refused_before_any_call", async () => {
    const { rpc, calls } = chunkRpc();
    await expect(uploadVideo(rpc, video(), () => {}, undefined, fakeFile(MAX_VIDEO_BYTES + 1))).rejects.toMatchObject({ code: "too_large_video" });
    expect(calls).toEqual([]);
  });

  test("an_older_herdlingd_gets_a_small_video_in_one_call_and_refuses_a_large_one", async () => {
    const { rpc, calls } = chunkRpc();
    const read = jest.fn(async () => "AAAA");
    const progress: number[] = [];
    const paths = await uploadPhotos(rpc, [video()], (n) => progress.push(n), read, { chunked: false, files: fakeFile(10) });
    expect(paths).toEqual(["/up/clip.mp4"]);
    expect(calls.map((c) => c.method)).toEqual(["files.put"]);
    expect(progress).toEqual([1]);

    calls.length = 0;
    read.mockClear();
    const err = await uploadPhotos(rpc, [video()], undefined, read, { chunked: false, files: fakeFile(MAX_FILE_BYTES + 1) }).catch((e: unknown) => e);
    expect((err as Error).message).toBe("Too large to attach (max 25.0 MB): clip.mp4. Update herdlingd for videos up to 500.0 MB.");
    expect(read).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  test("pick_media_asks_for_photos_and_videos_and_keeps_the_photo_cap", async () => {
    const launch = ImagePicker.launchImageLibraryAsync as jest.Mock;
    launch.mockClear();
    launch.mockResolvedValueOnce({
      canceled: false,
      assets: [
        { type: "image", uri: "file:///a", fileName: "a.png", base64: "AAA" },
        { type: "video", uri: "file:///cache/x.mp4", fileName: "IMG_1.MOV", fileSize: 1234, duration: 5000, mimeType: "video/mp4", base64: null },
        { type: "image", uri: "file:///b", fileName: "b.png", base64: "BBB" },
      ],
    });
    expect(await pickMedia(6, 1)).toEqual([
      { uri: "file:///a", name: "a.jpg", base64: "AAA" },
      { kind: "video", uri: "file:///cache/x.mp4", name: "IMG_1.mp4", size: 1234, duration: 5000, mime: "video/mp4" },
    ]);
    expect(launch).toHaveBeenLastCalledWith(
      expect.objectContaining({ mediaTypes: ["images", "videos"], selectionLimit: 6, videoExportPreset: 7, base64: true }),
    );
    launch.mockClear();
    expect(await pickMedia(0, 4)).toEqual([]);
    expect(launch).not.toHaveBeenCalled();
  });

  test("room_counts_a_video_as_an_item_not_a_photo", () => {
    expect(photoRoom([video(), video()])).toBe(4);
    expect(fileRoom([video(), video()])).toBe(MAX_ATTACHMENTS - 2);
  });

  test("a_pasted_video_becomes_an_attachment_or_an_error", () => {
    const ok = { uri: "file:///cache/herdling-paste/a.mov", name: "clip.mov", size: 10, duration: 1000, mime: "video/quicktime" };
    expect(fromPastedVideo(ok, 1, true)).toEqual({ video: { kind: "video", ...ok } });
    expect(fromPastedVideo(ok, 0, true)).toEqual({ error: `You can attach up to ${MAX_ATTACHMENTS} items.` });
    expect(fromPastedVideo({ name: "big.mov", size: 1, error: "too_large" }, 1, true)).toEqual({ error: tooLargeVideoText(["big.mov"], true) });
    expect(fromPastedVideo({ ...ok, size: MAX_FILE_BYTES + 1 }, 1, false)).toEqual({ error: tooLargeVideoText(["clip.mov"], false) });
    expect(fromPastedVideo({ name: "x.mov", size: 0, error: "No access" }, 1, true)).toEqual({ error: "Could not paste the video: No access" });
  });
});
