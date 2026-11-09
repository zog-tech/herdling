import { Alert, type AlertButton } from "react-native";

import { ensureKey } from "../../modules/ssh";
import { copyIfAvailable, hasClipboard } from "../ui/clipboard";
import { isDemoHost } from "../demo/demoHost";
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
  // The demo host has no companion and no key: remove it without a revoke (no key generation).
  if (isDemoHost(hostId)) {
    useHosts.getState().removeHost(hostId);
    return { revoked };
  }
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

/** The command that removes this phone's key and push token on the host. */
export function unpairCommand(deviceId: string): string {
  return `herdlingd unpair ${deviceId}`;
}

/**
 * The text of the remove dialog. An offline host cannot get `pair.revoke`: it keeps this phone's
 * key line and push token, so the text gives the command that removes them on the host.
 */
export function removeMessage(online: boolean, deviceId: string | undefined): string {
  const base = "The host and its pinned key are deleted from this phone.";
  if (online) return `${base} The host also forgets this phone's key.`;
  const kept = `${base} The host is offline, so it keeps this phone's key and push token.`;
  return deviceId ? `${kept} To remove them, run this on the host:\n\n${unpairCommand(deviceId)}` : kept;
}

/** After a remove with no revoke: the command to run on the host, with a Copy button. */
function showUnpairCommand(deviceId: string): void {
  const command = unpairCommand(deviceId);
  const buttons: AlertButton[] = [{ text: "OK", style: "cancel" }];
  if (hasClipboard()) buttons.unshift({ text: "Copy command", onPress: () => void copyIfAvailable(command) });
  Alert.alert("Run this on the host", `${command}\n\nThe host keeps this phone's key and push token until you run this command.`, buttons);
}

/** Asks before removing; `onRemoved` runs after the host is gone. */
export async function confirmRemoveHost(host: Host, onRemoved?: () => void): Promise<void> {
  if (isDemoHost(host)) {
    Alert.alert("Remove the demo?", "The demo computer and its sample agents go away. You can start the demo again at any time.", [
      { text: "Cancel", style: "cancel" },
      { text: "Remove demo", style: "destructive", onPress: () => void removeHostEverywhere(host.id).then(() => onRemoved?.()) },
    ]);
    return;
  }
  const online = getHostConn(host.id).status === "online";
  // The device id is in the Keychain. Without it, the text has no command and the remove still works.
  const deviceId = await getDeviceId().catch(() => undefined);
  Alert.alert(`Remove ${host.name}?`, removeMessage(online, deviceId), [
    { text: "Cancel", style: "cancel" },
    {
      text: "Remove",
      style: "destructive",
      onPress: async () => {
        const { revoked } = await removeHostEverywhere(host.id);
        onRemoved?.();
        if (!revoked && deviceId !== undefined) showUnpairCommand(deviceId);
      },
    },
  ]);
}
