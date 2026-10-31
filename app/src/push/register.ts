import type { PushRegister } from "@herdling/protocol";

import { deviceName, getDeviceId } from "../device";
import type { RpcClient } from "../rpc/RpcClient";
import { currentPrefs } from "./prefs";
import { getExpoToken } from "./token";

/**
 * Tells the companion behind `rpc` this phone's push token and prefs (`push.register`).
 * When the token lookup throws, nothing is sent, so the companion keeps the token it has.
 * Never throws: a failure is logged, and the host connection is not affected.
 */
export async function registerPush(
  rpc: Pick<RpcClient, "call">,
  hostId: string,
  deps?: { token?: () => Promise<string | null> },
): Promise<void> {
  try {
    const token = deps?.token ?? getExpoToken;
    const [deviceId, expoToken] = await Promise.all([getDeviceId(), token()]);
    const params: PushRegister = {
      device_id: deviceId,
      host_id: hostId,
      name: deviceName(),
      expo_token: expoToken,
      prefs: currentPrefs(),
    };
    await rpc.call("push.register", params);
  } catch (e) {
    console.warn(`[push] register on ${hostId} failed:`, e instanceof Error ? e.message : String(e));
  }
}
