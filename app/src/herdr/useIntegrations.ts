/**
 * The herdr integrations of one host for the integrations screen: the list, a reload, and an
 * install of one item with its progress and result. The state machine is plain, so the screen
 * only draws it.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { useHostConn } from "@/hosts/connection";
import { RpcError } from "@/rpc/RpcClient";

import { installIntegration, LIST_METHOD, listIntegrations, type IntegrationInfo } from "./integrations";
import { UNSUPPORTED, useHerdrSupports } from "./support";

export type IntegrationsState =
  | { kind: "loading" }
  | { kind: "offline" }
  | { kind: "unsupported" }
  | { kind: "error"; message: string }
  | { kind: "ready"; list: IntegrationInfo[] };

/** The result of the last install of one target. */
export type InstallResult = { ok: true; messages: string[] } | { ok: false; message: string };

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useIntegrations(hostId: string) {
  const { rpc } = useHostConn(hostId);
  const supported = useHerdrSupports(hostId, LIST_METHOD);
  const [state, setState] = useState<IntegrationsState>({ kind: "loading" });
  const [busy, setBusy] = useState<string>();
  const [results, setResults] = useState<Record<string, InstallResult>>({});
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    if (!rpc) return;
    try {
      const list = await listIntegrations(rpc, hostId);
      if (live.current) setState({ kind: "ready", list });
    } catch (e) {
      if (!live.current) return;
      if (e instanceof RpcError && e.code === UNSUPPORTED) setState({ kind: "unsupported" });
      else setState({ kind: "error", message: message(e) });
    }
  }, [rpc, hostId]);

  useEffect(() => {
    if (!rpc) setState({ kind: "offline" });
    else if (!supported) setState({ kind: "unsupported" });
    else {
      setState({ kind: "loading" });
      void load();
    }
  }, [rpc, supported, load]);

  const install = useCallback(
    async (target: string) => {
      if (!rpc || busy) return;
      setBusy(target);
      try {
        const messages = await installIntegration(rpc, hostId, target);
        if (live.current) setResults((r) => ({ ...r, [target]: { ok: true, messages } }));
        await load();
      } catch (e) {
        if (live.current) setResults((r) => ({ ...r, [target]: { ok: false, message: message(e) } }));
      } finally {
        if (live.current) setBusy(undefined);
      }
    },
    [rpc, hostId, busy, load],
  );

  return { state, busy, results, install, reload: load };
}
