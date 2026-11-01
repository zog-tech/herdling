import { Linking, Text } from "react-native";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { previewSupportedNow } from "@/preview/usePreview";
import { hasWebView } from "@/preview/webview";
import { showActionSheet } from "@/ui/nativeSheet";
import { useNotice } from "@/ui/notice";

import { LinkedText } from "./LinkText";
import { ThreadPaneContext, type ThreadPane } from "./LiveToolContext";

const mockPush = jest.fn();
jest.mock("expo-router", () => ({ router: { push: (...a: unknown[]) => mockPush(...a) } }));
jest.mock("@/ui/nativeSheet", () => ({ showActionSheet: jest.fn() }));
jest.mock("@/preview/webview", () => ({ hasWebView: jest.fn(() => true) }));
jest.mock("@/preview/usePreview", () => ({ previewSupportedNow: jest.fn(() => true) }));

const PANE: ThreadPane = { hostId: "studio", paneId: "w1:p1" };
const TEXT = "Dev server: http://localhost:5173/app?x=1. Docs: https://example.com/docs, mail mailto:sam@example.com";
const sheet = showActionSheet as jest.Mock;

let tree: ReactTestRenderer | undefined;
let openURL: jest.SpyInstance;
beforeEach(() => {
  mockPush.mockClear();
  sheet.mockClear();
  (hasWebView as jest.Mock).mockReturnValue(true);
  (previewSupportedNow as jest.Mock).mockReturnValue(true);
  useNotice.setState({ notice: undefined });
  openURL = jest.spyOn(Linking, "openURL").mockResolvedValue(undefined);
});
afterEach(() => {
  act(() => tree?.unmount());
  tree = undefined;
  openURL.mockRestore();
});

function render(text: string, pane: ThreadPane | null = PANE) {
  act(() => {
    tree = create(
      <ThreadPaneContext.Provider value={pane}>
        <Text>
          <LinkedText text={text} />
        </Text>
      </ThreadPaneContext.Provider>,
    );
  });
  return tree!.root.findAll((n) => (n.type as unknown) === "Text" && n.props.accessibilityRole === "link");
}

test("text_without_urls_has_no_links", () => {
  expect(render("Read main.rs and foo.com.")).toHaveLength(0);
});

test("each_url_is_one_link_without_the_trailing_punctuation", () => {
  const links = render(TEXT);
  expect(links.map((l) => l.props.children)).toEqual(["http://localhost:5173/app?x=1", "https://example.com/docs", "mailto:sam@example.com"]);
});

test("tap_on_a_local_url_opens_the_preview_with_the_path", () => {
  const [local] = render(TEXT);
  act(() => local.props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/preview/studio/5173?path=%2Fapp%3Fx%3D1");
  expect(openURL).not.toHaveBeenCalled();
});

test("tap_on_a_local_url_without_preview_shows_a_notice_and_no_browser", () => {
  (previewSupportedNow as jest.Mock).mockReturnValue(false);
  const [local] = render(TEXT);
  act(() => local.props.onPress());
  expect(mockPush).not.toHaveBeenCalled();
  expect(openURL).not.toHaveBeenCalled();
  expect(useNotice.getState().notice?.text).toMatch(/newer app/);
});

test("tap_on_a_web_url_opens_the_in_app_browser_or_the_system_browser", () => {
  const [, page] = render(TEXT);
  act(() => page.props.onPress());
  expect(mockPush).toHaveBeenCalledWith("/browser?url=https%3A%2F%2Fexample.com%2Fdocs");
  (hasWebView as jest.Mock).mockReturnValue(false);
  act(() => page.props.onPress());
  expect(openURL).toHaveBeenCalledWith("https://example.com/docs");
});

test("tap_on_mailto_opens_the_mail_app", () => {
  const [, , mail] = render(TEXT);
  act(() => mail.props.onPress());
  expect(openURL).toHaveBeenCalledWith("mailto:sam@example.com");
});

test("long_press_opens_the_link_menu", () => {
  const [local, page] = render(TEXT);
  act(() => page.props.onLongPress());
  expect(sheet).toHaveBeenCalledTimes(1);
  const [o, pick] = sheet.mock.calls[0];
  expect(o.title).toBe("https://example.com/docs");
  expect(o.options[0]).toBe("Open in Herdling");
  expect(o.options).toContain("Share");
  expect(o.options[o.options.length - 1]).toBe("Cancel");
  // "Open in Safari" (or "Open in browser") opens the system browser.
  act(() => pick(o.options.findIndex((s: string) => /^Open in (Safari|browser)$/.test(s))));
  expect(openURL).toHaveBeenCalledWith("https://example.com/docs");

  act(() => local.props.onLongPress());
  const [lo] = sheet.mock.calls[1];
  expect(lo.options[0]).toBe("Open preview");
  expect(lo.options.some((s: string) => /^Open in (Safari|browser)$/.test(s))).toBe(false);
});
