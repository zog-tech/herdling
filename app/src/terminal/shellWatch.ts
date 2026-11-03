/**
 * "Notify me when it finishes" for a shell pane: herdlingd sends one push when the command in the
 * pane finishes (`shell.watch`). The option shows only for a host that lists the method: an older
 * herdlingd cannot send the push. The calls go through the rpc that the caller passes in.
 */
import type { Hello, ShellUnwatch, ShellWatch, ShellWatches } from "@herdling/protocol";
import { useCallback, useEffect, useState } from "react";

import { getDeviceId } from "@/device";
import { listsMethod } from "@/hosts/methods";
import type { RpcClient } from "@/rpc/RpcClient";

type Rpc = Pick<RpcClient, "call">;

/** The label of the option. */
export const NOTIFY_LABEL = "Notify me when it finishes";
/** The label that turns the option off. */
export const STOP_NOTIFY_LABEL = "Do not notify me when it finishes";

/** True when the host can watch a shell pane. */
export const canWatchShell = (hello: Hello | undefined): boolean => listsMethod(hello, "shell.watch");

/** Asks the host for one push to this phone when the command in `paneId` finishes. */
export async function watchShell(rpc: Rpc, paneId: string): Promise<ShellWatch> {
  // Without a device id the push goes to every phone of the host: better than no push.
  const deviceId = await getDeviceId().catch(() => undefined);
  return rpc.call<ShellWatch>("shell.watch", deviceId ? { pane_id: paneId, device_id: deviceId } : { pane_id: paneId });
}

/** Removes the watch of `paneId`. */
export async function unwatchShell(rpc: Rpc, paneId: string): Promise<boolean> {
  return (await rpc.call<ShellUnwatch>("shell.unwatch", { pane_id: paneId })).removed;
}

/** True when the host watches `paneId`. */
export async function isShellWatched(rpc: Rpc, paneId: string): Promise<boolean> {
  const r = await rpc.call<ShellWatches>("shell.watches");
  return (r.watches ?? []).some((w) => w.pane_id === paneId);
}

/**
 * The watch state of a pane for the session menu. `supported` is false on an older host.
 * `refresh` asks the host again (herdlingd removes the watch after the push). `toggle` turns it on or off.
 */
export function useShellWatch(rpc: Rpc | undefined, hello: Hello | undefined, paneId: string, enabled: boolean) {
  const supported = enabled && !!rpc && canWatchShell(hello);
  const [watched, setWatched] = useState(false);

  const refresh = useCallback(() => {
    if (!supported || !rpc) return;
    isShellWatched(rpc, paneId)
      .then(setWatched)
      .catch(() => {});
  }, [supported, rpc, paneId]);

  useEffect(refresh, [refresh]);

  const toggle = useCallback(async () => {
    if (!supported || !rpc) return;
    if (watched) {
      await unwatchShell(rpc, paneId);
      setWatched(false);
    } else {
      await watchShell(rpc, paneId);
      setWatched(true);
    }
  }, [supported, rpc, paneId, watched]);

  return { supported, watched, refresh, toggle };
}
