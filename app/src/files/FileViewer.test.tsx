import type { FileDir, FileGet, FileImage, FileText } from "@herdling/protocol";
import { Image, Text } from "react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FileViewer, useFileViewer } from "./FileViewer";
import { thumbLoader } from "./thumbs";
import type { ViewerState } from "./viewerMachine";

let tree: ReactTestRenderer | undefined;
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
});

const dir: FileDir = {
  path: "/home/sam/proj/docs",
  name: "docs",
  kind: "dir",
  hidden: false,
  truncated: false,
  entries: [
    { name: "screens", kind: "dir" },
    { name: "home-dark.png", kind: "image", size: 2048 },
    { name: "README.md", kind: "file", size: 120 },
  ],
};
const text: FileText = { path: "/home/sam/proj/a.md", name: "a.md", kind: "text", size: 300_000, text: "# Title\n", truncated: true };

function render(view: ViewerState, extra: { onOpen?: jest.Mock; onRetry?: jest.Mock; fetchThumb?: (p: string) => Promise<FileGet> } = {}) {
  const onOpen = extra.onOpen ?? jest.fn();
  const onRetry = extra.onRetry ?? jest.fn();
  act(() => {
    tree = create(
      <GestureHandlerRootView>
        <FileViewer view={view} onOpen={onOpen} onRetry={onRetry} fetchThumb={extra.fetchThumb} loader={thumbLoader(2, 10)} />
      </GestureHandlerRootView>,
    );
  });
  return { t: tree!, onOpen, onRetry };
}

const allText = (t: ReactTestRenderer) =>
  t.root
    .findAll((n) => n.type === Text)
    .map((n) => {
      const c = n.props.children;
      return Array.isArray(c) ? c.join("") : typeof c === "string" ? c : "";
    })
    .join("\n");
const button = (t: ReactTestRenderer, label: string) => t.root.find((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === "function");

test("a_folder_lists_its_entries_and_opens_them", () => {
  const { t, onOpen } = render({ kind: "ready", gen: 1, file: dir });
  const s = allText(t);
  expect(s).toContain("screens");
  expect(s).toContain("README.md");
  expect(s).toContain("120 B");
  act(() => button(t, "Folder screens").props.onPress());
  expect(onOpen).toHaveBeenCalledWith("/home/sam/proj/docs/screens");
  act(() => button(t, "Parent folder").props.onPress());
  expect(onOpen).toHaveBeenLastCalledWith("/home/sam/proj");
});

test("a_small_image_in_a_folder_gets_a_thumbnail", async () => {
  const png: FileImage = { path: "/home/sam/proj/docs/home-dark.png", name: "home-dark.png", kind: "image", size: 3, mime: "image/png", offset: 0, data_b64: "AAAA", eof: true };
  const fetchThumb = jest.fn(() => Promise.resolve(png as FileGet));
  const { t } = render({ kind: "ready", gen: 1, file: dir }, { fetchThumb });
  await act(async () => {
    await Promise.resolve();
  });
  expect(fetchThumb).toHaveBeenCalledWith("/home/sam/proj/docs/home-dark.png");
  expect(t.root.findAll((n) => n.type === Image).map((n) => n.props.source.uri)).toEqual(["data:image/png;base64,AAAA"]);
});

test("a_text_file_is_selectable_and_says_when_it_is_cut", () => {
  const { t } = render({ kind: "ready", gen: 1, file: text });
  expect(t.root.findAll((n) => n.type === Text && n.props.selectable === true && n.props.children === "# Title\n")).toHaveLength(1);
  expect(allText(t)).toContain("Only the first 256 KB shows. The file has 293 KB.");
});

test("a_missing_path_says_so_and_can_retry", () => {
  const { t, onRetry } = render({ kind: "failed", gen: 1, code: "not_found", message: "files.get: no such file" });
  expect(allText(t)).toContain("This file or folder does not exist on the computer.");
  act(() => button(t, "Retry").props.onPress());
  expect(onRetry).toHaveBeenCalled();
});

test("another_file_shows_its_name_size_and_type", () => {
  const { t } = render({ kind: "ready", gen: 1, file: { path: "/a/doc.pdf", name: "doc.pdf", kind: "other", size: 2048, mime: "application/pdf" } });
  const s = allText(t);
  expect(s).toContain("doc.pdf");
  expect(s).toContain("2 KB · application/pdf");
});

test("an_image_too_large_shows_facts", () => {
  const { t } = render({ kind: "ready", gen: 1, file: { path: "/a/b.png", name: "b.png", kind: "image", size: 30 << 20, mime: "image/png", too_large: true } });
  expect(allText(t)).toContain("This image is too large to show on the phone.");
  expect(t.root.findAll((n) => n.type === Image)).toHaveLength(0);
});

test("an_image_shows_full_screen_from_its_bytes", () => {
  const { t } = render({ kind: "ready", gen: 1, file: { path: "/a/b.png", name: "b.png", kind: "image", size: 3, mime: "image/png", data_b64: "AAAA", eof: true } });
  // The image draws after the first layout, when its box size is known.
  const box = t.root.find((n) => typeof n.props.onLayout === "function");
  act(() => box.props.onLayout({ nativeEvent: { layout: { width: 300, height: 500, x: 0, y: 0 } } }));
  const img = t.root.find((n) => n.type === Image);
  expect(img.props.source).toEqual({ uri: "data:image/png;base64,AAAA" });
  expect(img.props.accessibilityLabel).toBe("b.png");
});

function Harness({ fetchFile, onState }: { fetchFile: (offset: number) => Promise<FileGet>; onState: (s: ViewerState) => void }) {
  const { state } = useFileViewer(fetchFile);
  onState(state);
  return null;
}

test("the_hook_loads_an_image_in_parts", async () => {
  const part = (offset: number, data: string, eof: boolean): FileGet => ({ path: "/a/s.png", name: "s.png", kind: "image", size: 6, mime: "image/png", offset, data_b64: data, eof });
  const fetchFile = jest.fn((offset: number) => Promise.resolve(offset === 0 ? part(0, "AAAA", false) : part(3, "BBBB", true)));
  let last: ViewerState | undefined;
  await act(async () => {
    tree = create(<Harness fetchFile={fetchFile} onState={(s) => (last = s)} />);
  });
  await act(async () => {
    await Promise.resolve();
  });
  expect(fetchFile.mock.calls.map((c) => c[0])).toEqual([0, 3]);
  expect(last).toMatchObject({ kind: "ready", file: { data_b64: "AAAABBBB" } });
});
