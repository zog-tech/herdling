/**
 * The browser preview of the demo host: two listening ports and a static page. The demo has no
 * computer, so the preview screen shows this page in place of a dev server.
 */
import type { PortInfo, PreviewOpen } from "@herdling/protocol";

import { DemoError } from "./scenario";

/** The demo dev servers. The first one belongs to the asked pane. */
export function demoPorts(paneId: string | undefined): PortInfo[] {
  return [
    { port: 5173, addr: "::1", pid: 4411, process: "node", cmd: "vite", ...(paneId ? { pane_id: paneId } : {}) },
    { port: 3000, addr: "127.0.0.1", pid: 3900, process: "node", cmd: "next-server" },
  ];
}

const HEX = "0123456789abcdef";

/** `preview.open` of the demo: a grant for a demo port, else `port_not_listening`. */
export function demoPreviewOpen(port: unknown, now = Date.now()): PreviewOpen {
  if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
    throw new DemoError("bad_request", "preview.open requires port, a number from 1 to 65535");
  }
  if (!demoPorts(undefined).some((p) => p.port === port)) {
    throw new DemoError("port_not_listening", `nothing listens on port ${port} on loopback`);
  }
  let grant = "";
  for (let i = 0; i < 32; i++) grant += HEX[Math.floor(Math.random() * 16)];
  return { grant, port, expires_at: Math.floor(now / 1000) + 30 * 60 };
}

/** The static page that the demo preview shows for `port`. Inline styles only, no network. */
export function demoPreviewHtml(port: number): string {
  const app = port === 3000 ? "Next.js" : "Vite + React";
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Demo app</title>
<style>
body{margin:0;font-family:-apple-system,system-ui,sans-serif;background:#0A0A0B;color:#F5F2EA}
main{padding:32px 20px;max-width:520px;margin:0 auto}
h1{font-size:28px;margin:0 0 8px}
p{color:#A39E93;line-height:1.5}
.card{background:#141416;border:1px solid #2A2A2E;border-radius:10px;padding:16px;margin-top:20px}
button{font:inherit;font-weight:600;background:#D4A857;color:#0A0A0B;border:0;border-radius:10px;padding:12px 18px;margin-top:8px}
code{font-family:ui-monospace,Menlo,monospace;color:#F5F2EA}
</style></head>
<body><main>
<h1>Demo app</h1>
<p>This is the browser preview of the demo computer. On your computer it shows your dev server
(<code>localhost:${port}</code>, ${app}), and file saves reload the page.</p>
<div class="card">
<p>Count: <strong id="n">0</strong></p>
<button onclick="document.getElementById('n').textContent=String(++window.c)">Add one</button>
</div>
</main><script>window.c=0</script></body></html>`;
}
