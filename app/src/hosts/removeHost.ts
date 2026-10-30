import { Alert } from "react-native";

import { ensureKey } from "../../modules/ssh";
import { getDeviceId } from "../device";
import type { RpcClient } from "../rpc/RpcClient";
import { getHostConn } from "./connection";
import { useHosts, type Host } from "./store";

const REVOKE_TIMEOUT_MS = 5_000;

/**
 * Removes a saved host. When the host is online, first asks its companion to drop this
 * phone's key (`pair.revoke`); a failed revoke does not stop the removal.
 * `revoked` is true when the companion confirmed.
 */
export async function removeHostEverywhere(
  hostId: string,
  deps?: { rpc?: Pick<RpcClient, "call"> },
): Promise<{ revoked: boolean }> {
  let revoked = false;
  const conn = getHostConn(hostId);
  const rpc = deps?.rpc ?? (conn.status === "online" ? conn.rpc : undefined);
  if (rpc) {
    try {
      const [device_id, key] = await Promise.all([getDeviceId(), ensureKey()]);
      await rpc.call("pair.revoke", { device_id, public_key: key.publicKey }, REVOKE_TIMEOUT_MS);
      revoked = true;
    } catch {
      // Offline, timed out or an older companion: remove the host anyway.
    }
  }
  useHosts.getState().removeHost(hostId);
  return { revoked };
}

/** Asks before removing; `onRemoved` runs after the host is gone. */
export function confirmRemoveHost(host: Host, onRemoved?: () => void): void {
  Alert.alert(
    `Remove ${host.name}?`,
    "The host and its pinned key are deleted from this phone. When the host is online, it also forgets this phone's key.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: () => {
          void removeHostEverywhere(host.id).then(() => onRemoved?.());
        },
      },
    ],
  );
}
