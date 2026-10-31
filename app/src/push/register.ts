import type { Hello, PushCapability, PushRegister } from "@herdling/protocol";

import { deviceName, getDeviceId } from "../device";
import { listsMethod } from "../hosts/methods";
import type { RpcClient } from "../rpc/RpcClient";
import { currentPrefs } from "./prefs";
import { getExpoToken } from "./token";

/**
 * The push features to tell a host about. The Yes and No buttons need `pane.answer` on the host,
 * so `choice_actions` goes only to a host that lists it.
 */
export function pushCapabilities(hello: Hello | undefined): PushCapability[] {
  return listsMethod(hello, "pane.answer") ? ["choice_actions"] : [];
}

/**
 * Tells the companion behind `rpc` this phone's push token and prefs (`push.register`).
 * `hello` is the host's hello: it decides the `capabilities`.
 * When the token lookup throws, nothing is sent, so the companion keeps the token it has.
 * Never throws: a failure is logged, and the host connection is not affected.
 */
export async function registerPush(
  rpc: Pick<RpcClient, "call">,
  hostId: string,
  deps?: { token?: () => Promise<string | null>; hello?: Hello },
): Promise<void> {
  try {
    const token = deps?.token ?? getExpoToken;
    const [deviceId, expoToken] = await Promise.all([getDeviceId(), token()]);
    const capabilities = pushCapabilities(deps?.hello);
    const params: PushRegister = {
      device_id: deviceId,
      host_id: hostId,
      name: deviceName(),
      expo_token: expoToken,
      prefs: currentPrefs(),
      // A host without `pane.answer` gets the same params as before.
      ...(capabilities.length ? { capabilities } : {}),
    };
    await rpc.call("push.register", params);
  } catch (e) {
    console.warn(`[push] register on ${hostId} failed:`, e instanceof Error ? e.message : String(e));
  }
}
