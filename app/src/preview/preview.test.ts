import type { Hello } from "@herdling/protocol";

import { addressText, deskUrl, localUrl, portLabel, previewSupported, proxyCommand, staysInPreview } from "./preview";

const G = "0123456789abcdef0123456789abcdef";
const hello = (methods?: string[]): Hello => ({ host: "h", os: "linux", herdlingd: "1", herdr_ok: true, methods });

test("proxyCommand_replaces_the_trailing_rpc", () => {
  expect(proxyCommand("herdlingd rpc", 5173, G)).toBe(`herdlingd proxy 5173 ${G}`);
  expect(proxyCommand("~/.local/bin/herdlingd rpc", 3000, G)).toBe(`~/.local/bin/herdlingd proxy 3000 ${G}`);
  expect(proxyCommand("  /opt/bin/herdlingd   rpc ", 1, G)).toBe(`/opt/bin/herdlingd proxy 1 ${G}`);
  // A command that does not end in rpc: the plain proxy command.
  expect(proxyCommand("herdlingd", 8080, G)).toBe(`herdlingd proxy 8080 ${G}`);
});

test("proxyCommand_rejects_bad_ports_and_grants", () => {
  expect(() => proxyCommand("herdlingd rpc", 0, G)).toThrow();
  expect(() => proxyCommand("herdlingd rpc", 65536, G)).toThrow();
  expect(() => proxyCommand("herdlingd rpc", 80.5, G)).toThrow();
  expect(() => proxyCommand("herdlingd rpc", 80, "x; rm -rf ~")).toThrow();
  expect(() => proxyCommand("herdlingd rpc", 80, G.toUpperCase())).toThrow();
});

test("previewSupported_needs_the_method_the_web_view_and_the_proxy", () => {
  const all = { webView: true, nativeProxy: true, demo: false };
  expect(previewSupported(hello(["preview.open"]), all)).toBe(true);
  expect(previewSupported(hello(["ping"]), all)).toBe(false);
  expect(previewSupported(hello(), all)).toBe(false);
  expect(previewSupported(undefined, all)).toBe(false);
  expect(previewSupported(hello(["preview.open"]), { ...all, webView: false })).toBe(false);
  expect(previewSupported(hello(["preview.open"]), { ...all, nativeProxy: false })).toBe(false);
  // The demo host shows a static page: it needs the web view only.
  expect(previewSupported(hello(["preview.open"]), { webView: true, nativeProxy: false, demo: true })).toBe(true);
});

test("portLabel_names_the_program_and_the_pane", () => {
  expect(portLabel({ port: 5173, addr: "::1", cmd: "vite", process: "node", pane_id: "p1" }, "p1")).toBe("5173 · vite · this pane");
  expect(portLabel({ port: 3000, addr: "127.0.0.1", process: "next-server" }, "p1")).toBe("3000 · next-server");
  expect(portLabel({ port: 8080, addr: "0.0.0.0" })).toBe("8080 · 0.0.0.0");
});

test("urls_map_the_local_port_to_the_desk_port", () => {
  expect(localUrl(5173)).toBe("http://localhost:5173/");
  expect(localUrl(49152, "app")).toBe("http://localhost:49152/app");
  expect(deskUrl("http://localhost:49152/app?x=1", 49152, 5173)).toBe("http://localhost:5173/app?x=1");
  expect(deskUrl("http://localhost:49152", 49152, 5173)).toBe("http://localhost:5173");
  expect(deskUrl("http://localhost:491520/", 49152, 5173)).toBe("http://localhost:491520/");
  expect(deskUrl("https://example.com/", 49152, 5173)).toBe("https://example.com/");
  expect(addressText("http://localhost:5173/a", 5173, 5173)).toBe("localhost:5173/a");
});

test("staysInPreview_allows_only_the_preview_origin", () => {
  expect(staysInPreview("http://localhost:5173/", 5173)).toBe(true);
  expect(staysInPreview("http://localhost:5173", 5173)).toBe(true);
  expect(staysInPreview("http://127.0.0.1:5173/x", 5173)).toBe(true);
  expect(staysInPreview("about:blank", 5173)).toBe(true);
  expect(staysInPreview("http://localhost:51730/", 5173)).toBe(false);
  expect(staysInPreview("http://localhost:3000/", 5173)).toBe(false);
  expect(staysInPreview("https://example.com/", 5173)).toBe(false);
  expect(staysInPreview("http://localhost:5173.evil.test/", 5173)).toBe(false);
  expect(staysInPreview("http://localhost:5173/", undefined)).toBe(false);
});
