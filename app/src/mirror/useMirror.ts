/**
 * React parts of the device mirror: whether it shows for a host, the device list, and the I/O
 * shell of the tunnel state machine (`tunnel.ts`) of one mirror screen.
 */
import type { DevicesList, MirrorStart } from "@herdling/protocol";
import { useCallback, useEffect, useRef, useState } from "react";

import * as ssh from "../../modules/ssh";
import { isDemoHost } from "@/demo/demoHost";
import { getHostConn, useHostConn } from "@/hosts/connection";
import { useHosts } from "@/hosts/store";
import { proxyCommand } from "@/preview/preview";
import { useAppActive } from "@/preview/usePreview";
import { hasWebView } from "@/preview/webview";

import { mirrorSupported } from "./devices";
import { initialTunnel, reduceTunnel, type MirrorEffect, type MirrorEvent, type MirrorTunnel } from "./tunnel";

/** True when the device mirror shows for the host (see `mirrorSupported`). */
export function useMirrorSupported(hostId: string): boolean {
  const { hello } = useHostConn(hostId);
  return mirrorSupported(hello, { webView: hasWebView(), nativeProxy: ssh.hasNativePreview(), demo: isDemoHost(hostId) });
}

/** The same check, read once: for a tap outside a render. */
export function mirrorSupportedNow(hostId: string): boolean {
  return mirrorSupported(getHostConn(hostId).hello, { webView: hasWebView(), nativeProxy: ssh.hasNativePreview(), demo: isDemoHost(hostId) });
}

const message = (e: unknown) => {
  const text = e instanceof Error ? e.message : String(e);
  return text.split(/Caused by:\s*/).pop()?.trim() || text;
};

export type DevicesState = { kind: "loading" } | { kind: "offline" } | { kind: "ready"; list: DevicesList } | { kind: "error"; message: string };

/** `devices.list` of the host, with a reload. */
export function useDevices(hostId: string): { state: DevicesState; reload: () => Promise<void> } {
  const { rpc } = useHostConn(hostId);
  const [state, setState] = useState<DevicesState>({ kind: "loading" });
  const live = useRef(true);
  const reload = useCallback(async () => {
    if (!rpc) {
      setState({ kind: "offline" });
      return;
    }
    try {
      const list = await rpc.call<DevicesList>("devices.list");
      if (live.current) setState({ kind: "ready", list });
    } catch (e) {
      if (live.current) setState({ kind: "error", message: message(e) });
    }
  }, [rpc]);
  useEffect(() => {
    live.current = true;
    void reload();
    return () => {
      live.current = false;
    };
  }, [reload]);
  return { state, reload };
}

/** Calls, the phone listener and the host command that the runner needs. Tests pass fakes. */
export type MirrorIo = {
  call<T>(method: string, params: object): Promise<T> | undefined;
  startPreview(port: number, command: string): Promise<{ localPort: number }>;
  stopPreview(localPort: number): Promise<unknown>;
  command(): string | undefined;
};

/**
 * The I/O shell of the tunnel state machine: it sends the events and runs the effects. The
 * state lives here, outside React, so the close effects also run at unmount.
 */
export class MirrorRunner {
  state: MirrorTunnel = initialTunnel;
  private listener?: (s: MirrorTunnel) => void;

  constructor(
    private readonly device: string,
    private readonly io: MirrorIo,
  ) {}

  subscribe(f: (s: MirrorTunnel) => void): () => void {
    this.listener = f;
    return () => {
      if (this.listener === f) this.listener = undefined;
    };
  }

  send(e: MirrorEvent): void {
    const r = reduceTunnel(this.state, e);
    this.state = r.state;
    this.listener?.(r.state);
    for (const fx of r.effects) this.run(fx);
  }

  private run(fx: MirrorEffect): void {
    const io = this.io;
    switch (fx.type) {
      case "start": {
        const p = io.call<MirrorStart>("mirror.start", { device: this.device });
        if (!p) this.send({ type: "failed", gen: fx.gen, message: "the computer is offline" });
        else p.then((result) => this.send({ type: "started", gen: fx.gen, result }), (e) => this.send({ type: "failed", gen: fx.gen, message: message(e) }));
        return;
      }
      case "openTunnel": {
        const cmd = io.command();
        if (cmd === undefined) {
          this.send({ type: "failed", gen: fx.gen, message: "the host has no command" });
          return;
        }
        io.startPreview(fx.port, proxyCommand(cmd, fx.port, fx.grant)).then(
          (r) => this.send({ type: "tunnelOpen", gen: fx.gen, localPort: r.localPort, now: Date.now() }),
          (e) => this.send({ type: "failed", gen: fx.gen, message: message(e) }),
        );
        return;
      }
      case "stopTunnel":
        void io.stopPreview(fx.localPort).catch(() => {});
        return;
      case "closeGrant":
        io.call("preview.close", { grant: fx.grant })?.catch(() => {});
        return;
      case "stopMirror":
        io.call("mirror.stop", { device: this.device })?.catch(() => {});
        return;
    }
  }
}

/** The production I/O of a host. */
function hostIo(hostId: string): MirrorIo {
  return {
    // The connection that is open now: a dropped one cannot take a call.
    call: <T,>(method: string, params: object) => getHostConn(hostId).rpc?.call<T>(method, params),
    startPreview: (port, command) => ssh.startPreview(hostId, port, command),
    stopPreview: (localPort) => ssh.stopPreview(localPort),
    command: () => useHosts.getState().hosts.find((h) => h.id === hostId)?.command,
  };
}

/**
 * The tunnel of one mirror screen. It begins when the host is online and the app is in the
 * foreground, pauses on background or a lost connection, and stops the mirror on unmount.
 * `retry` begins again.
 */
export function useMirror(hostId: string, device: string): { tunnel: MirrorTunnel; retry: () => void } {
  const { rpc } = useHostConn(hostId);
  const active = useAppActive();
  const [runner] = useState(() => new MirrorRunner(device, hostIo(hostId)));
  const [tunnel, setTunnel] = useState<MirrorTunnel>(runner.state);

  useEffect(() => runner.subscribe(setTunnel), [runner]);
  useEffect(() => {
    if (active && rpc) runner.send({ type: "begin", now: Date.now() });
    else runner.send({ type: "pause" });
  }, [active, rpc, runner]);
  useEffect(() => () => runner.send({ type: "close" }), [runner]);

  const retry = useCallback(() => runner.send({ type: "begin", now: Date.now() }), [runner]);
  return { tunnel, retry };
}
