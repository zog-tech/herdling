/**
 * Which newer herdr methods a host lacks. The app sends herdr methods through `herdr.call`, so
 * `hello.methods` does not list them. An older herdr refuses an unknown method: herdr itself
 * answers `invalid_request` ("unknown variant ..."), a fake or a proxy answers `unknown_method`.
 * The app remembers each refused method per host for this app run and hides its feature.
 */
import { create } from "zustand";

import { RpcError, type RpcClient } from "@/rpc/RpcClient";

type Rpc = Pick<RpcClient, "call">;

/** herdr methods that a host refused as unknown, per host id. */
export const useHerdrSupport = create<{ missing: Record<string, string[]> }>(() => ({ missing: {} }));

/** True when the error says that herdr does not know the method. */
export function isMissingMethod(e: unknown): boolean {
  const code = (e as { code?: unknown } | null)?.code;
  const msg = e instanceof Error ? e.message : String(e);
  if (code === "unknown_method") return true;
  if (code === "invalid_request") return /unknown variant|unknown method/i.test(msg);
  return /unknown method/i.test(msg);
}

/** False after the host refused `method` as unknown. */
export function herdrSupports(hostId: string, method: string): boolean {
  return !(useHerdrSupport.getState().missing[hostId] ?? []).includes(method);
}

/** The same as `herdrSupports`, as a hook: the view updates when a refusal arrives. */
export function useHerdrSupports(hostId: string, method: string): boolean {
  return useHerdrSupport((s) => !(s.missing[hostId] ?? []).includes(method));
}

export function markHerdrMissing(hostId: string, method: string): void {
  useHerdrSupport.setState((s) => {
    const cur = s.missing[hostId] ?? [];
    return cur.includes(method) ? s : { missing: { ...s.missing, [hostId]: [...cur, method] } };
  });
}

/** The error code of a herdr method that the host does not have. */
export const UNSUPPORTED = "herdr_unsupported";

/**
 * Calls `method` of herdr through `herdr.call`. When herdr does not know the method, it remembers
 * that for `hostId` and throws an `RpcError` with the code `UNSUPPORTED`.
 */
export async function callHerdr<T>(rpc: Rpc, hostId: string, method: string, params: object, timeoutMs?: number): Promise<T> {
  try {
    return await rpc.call<T>("herdr.call", { method, params }, timeoutMs);
  } catch (e) {
    if (isMissingMethod(e)) {
      markHerdrMissing(hostId, method);
      throw new RpcError(UNSUPPORTED, "The herdr on this computer is too old for this. Update herdr to use it.");
    }
    throw e;
  }
}
