/**
 * Browser preview rules with no native parts: when the preview shows, the proxy command, the
 * port labels and the URLs. The screen is `app/preview/[hostId]/[port].tsx`.
 */
import type { Hello, PortInfo } from "@herdling/protocol";

import { listsMethod } from "@/hosts/methods";

const GRANT = /^[0-9a-f]{32}$/;

/** True for a whole number from 1 to 65535. */
export function validPort(port: number): boolean {
  return Number.isInteger(port) && port >= 1 && port <= 65535;
}

/**
 * The command of a proxy channel: the host command with its last word `rpc` replaced by
 * `proxy <port> <grant>`. With the phone key, sshd runs the forced command and herdlingd reads
 * this text from `SSH_ORIGINAL_COMMAND`. A host without a forced command runs it in the shell.
 */
export function proxyCommand(hostCommand: string, port: number, grant: string): string {
  if (!validPort(port)) throw new Error(`invalid port ${port}`);
  if (!GRANT.test(grant)) throw new Error("invalid grant");
  const words = hostCommand.trim().split(/\s+/);
  if (words.length >= 2 && words[words.length - 1] === "rpc") {
    words[words.length - 1] = `proxy ${port} ${grant}`;
    return words.join(" ");
  }
  return `herdlingd proxy ${port} ${grant}`;
}

/**
 * True when the preview can show for a host: the host lists `preview.open`, the build has the
 * web view, and (except for the demo host, which shows a static page) the ssh module has the proxy.
 */
export function previewSupported(hello: Hello | undefined, o: { webView: boolean; nativeProxy: boolean; demo: boolean }): boolean {
  return listsMethod(hello, "preview.open") && o.webView && (o.demo || o.nativeProxy);
}

/** "5173 · vite · this pane". */
export function portLabel(p: PortInfo, paneId?: string): string {
  const parts = [String(p.port), p.cmd || p.process || p.addr];
  if (paneId && p.pane_id === paneId) parts.push("this pane");
  return parts.join(" · ");
}

/** The URL that the web view loads for the phone's local port. */
export function localUrl(localPort: number, path = "/"): string {
  return `http://localhost:${localPort}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * The URL as the user knows it at the desk: `localhost:<local port>` becomes `localhost:<port>`.
 * Other URLs stay as they are.
 */
export function deskUrl(url: string, localPort: number | undefined, port: number): string {
  if (localPort === undefined) return url;
  const prefix = `http://localhost:${localPort}`;
  if (url === prefix || url.startsWith(`${prefix}/`) || url.startsWith(`${prefix}?`) || url.startsWith(`${prefix}#`)) {
    return `http://localhost:${port}${url.slice(prefix.length)}`;
  }
  return url;
}

/** The address bar text: the desk URL without `http://`. */
export function addressText(url: string, localPort: number | undefined, port: number): string {
  return deskUrl(url, localPort, port).replace(/^http:\/\//, "");
}

/**
 * True when the web view may load `url` in place: pages of the preview origin and blank pages.
 * Other links open in the system browser, so the preview never reaches other hosts.
 */
export function staysInPreview(url: string, localPort: number | undefined): boolean {
  if (url === "about:blank" || url.startsWith("about:")) return true;
  if (localPort === undefined) return false;
  const re = new RegExp(`^http://(localhost|127\\.0\\.0\\.1):${localPort}([/?#]|$)`);
  return re.test(url);
}
