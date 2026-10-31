import { useHosts, type Host } from "@/hosts/store";

/**
 * The demo host: a computer that runs inside the app, with no network (see `DemoTransport`).
 * App Review and new users use it to go through the app without a computer that runs herdlingd.
 */
export const DEMO_HOST_ID = "demo";
export const DEMO_HOST_NAME = "Demo computer";
/** The line under the demo host in host lists. */
export const DEMO_HOST_DETAIL = "Runs inside this app. No computer or network needed.";

/** True for the demo host (by its id, or by the `demo` mark on a saved entry). */
export function isDemoHost(host: string | Pick<Host, "id" | "demo"> | undefined): boolean {
  if (!host) return false;
  if (typeof host === "string") return host === DEMO_HOST_ID;
  return host.demo === true || host.id === DEMO_HOST_ID;
}

/** Waits until the saved hosts are loaded from the Keychain. A host added before that would be lost. */
function hostsHydrated(): Promise<void> {
  const persist = (useHosts as { persist?: typeof useHosts.persist }).persist;
  if (!persist || persist.hasHydrated()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = persist.onFinishHydration(() => {
      off();
      resolve();
    });
  });
}

/**
 * Adds the demo host when it is not saved yet. The entry persists like a normal host;
 * its agents and threads start again on each launch. Returns the demo host id.
 */
export async function startDemo(): Promise<string> {
  await hostsHydrated();
  const store = useHosts.getState();
  if (!store.hosts.some((h) => isDemoHost(h))) {
    store.addHost({ id: DEMO_HOST_ID, name: DEMO_HOST_NAME, address: "demo", port: 0, user: "demo", demo: true });
  }
  return DEMO_HOST_ID;
}
