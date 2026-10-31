/**
 * React parts of the browser preview: whether it shows, the port list, and the tunnel of one
 * open preview (grant, native listener, stop on close and on background).
 */
import type { PortInfo, PortsList, PreviewOpen } from "@herdling/protocol";
import { useEffect, useState } from "react";
import { AppState } from "react-native";

import * as ssh from "../../modules/ssh";
import { isDemoHost } from "@/demo/demoHost";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";

import { previewSupported, proxyCommand } from "./preview";
import { hasWebView } from "./webview";

/** How often the session screen asks for the port list while it is in view. */
const PORTS_EVERY_MS = 30_000;

/** True when the preview can show for the host (see `previewSupported`). */
export function usePreviewSupported(hostId: string): boolean {
  const { hello } = useHostConn(hostId);
  return previewSupported(hello, { webView: hasWebView(), nativeProxy: ssh.hasNativePreview(), demo: isDemoHost(hostId) });
}

/** The listening ports of the host, the pane's ports first. Undefined until the first answer or while off. */
export function usePorts(hostId: string, paneId: string, active: boolean): PortInfo[] | undefined {
  const { rpc } = useHostConn(hostId);
  const [ports, setPorts] = useState<PortInfo[]>();
  useEffect(() => {
    if (!active || !rpc) {
      setPorts(undefined);
      return;
    }
    let live = true;
    const load = () =>
      rpc
        .call<PortsList>("ports.list", { pane_id: paneId })
        .then((r) => live && setPorts(r.ports))
        .catch(() => live && setPorts(undefined));
    void load();
    const timer = setInterval(load, PORTS_EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [rpc, paneId, active]);
  return ports;
}

/** True while the app is in the foreground. */
export function useAppActive(): boolean {
  const [active, setActive] = useState(AppState.currentState !== "background" && AppState.currentState !== "inactive");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => setActive(s === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

export type Tunnel =
  | { phase: "starting" }
  | { phase: "ready"; localPort?: number; started: number }
  | { phase: "paused" }
  | { phase: "error"; message: string };

const message = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e);
  return text.split(/Caused by:\s*/).pop()?.trim() || text;
};

/**
 * The tunnel of one preview: asks for a grant, starts the native listener, and stops both when
 * the screen closes or the app leaves the foreground. A reconnect of the host starts it again.
 * The demo host has no tunnel: it is ready at once with no local port.
 */
export function useTunnel(hostId: string, port: number, retry: number): Tunnel {
  const { rpc } = useHostConn(hostId);
  const active = useAppActive();
  const command = useHosts((s) => s.hosts.find((h) => h.id === hostId)?.command);
  const [tunnel, setTunnel] = useState<Tunnel>({ phase: "starting" });

  useEffect(() => {
    if (!active) {
      setTunnel({ phase: "paused" });
      return;
    }
    if (isDemoHost(hostId)) {
      setTunnel({ phase: "ready", started: Date.now() });
      return;
    }
    if (!rpc || command === undefined) {
      setTunnel({ phase: "starting" });
      return;
    }
    let live = true;
    let grant: string | undefined;
    let localPort: number | undefined;
    setTunnel({ phase: "starting" });
    (async () => {
      try {
        const open = await rpc.call<PreviewOpen>("preview.open", { port });
        grant = open.grant;
        if (!live) {
          rpc.call("preview.close", { grant: open.grant }).catch(() => {});
          return;
        }
        const started = await ssh.startPreview(hostId, port, proxyCommand(command, port, open.grant));
        localPort = started.localPort;
        if (!live) {
          void ssh.stopPreview(started.localPort);
          return;
        }
        setTunnel({ phase: "ready", localPort: started.localPort, started: Date.now() });
      } catch (e) {
        if (live) setTunnel({ phase: "error", message: message(e) });
      }
    })();
    return () => {
      live = false;
      if (localPort !== undefined) void ssh.stopPreview(localPort);
      const g = grant;
      // The grant goes on the connection that is open now; a dropped one cannot take it.
      const now = getHostConn(hostId).rpc;
      if (g && now) now.call("preview.close", { grant: g }).catch(() => {});
    };
  }, [hostId, port, rpc, command, active, retry]);

  return tunnel;
}
