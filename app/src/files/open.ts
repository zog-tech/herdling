import { useHostConn } from "@/hosts/connection";
import { listsMethod } from "@/hosts/methods";

/**
 * Opens a path from the thread in the file viewer (`app/file/[hostId].tsx`). Only a host whose
 * herdlingd lists `files.get` makes paths tappable: an older herdlingd shows them as plain code.
 */

/** Loaded on first use: the router module is large, and thread rows load this module. */
const router = () => (require("expo-router") as typeof import("expo-router")).router;

/** The viewer route for a path. `paneId` gives the session folder for a relative path. */
export function fileHref(hostId: string, path: string, paneId?: string) {
  return { pathname: "/file/[hostId]", params: { hostId, path, ...(paneId ? { paneId } : {}) } } as const;
}

export function openFile(hostId: string, path: string, paneId?: string): void {
  router().push(fileHref(hostId, path, paneId) as never);
}

/** True when the host can show files: it is known and its herdlingd lists `files.get`. */
export function useCanOpenFiles(hostId: string | undefined): boolean {
  const hello = useHostConn(hostId ?? "").hello;
  return !!hostId && listsMethod(hello, "files.get");
}
