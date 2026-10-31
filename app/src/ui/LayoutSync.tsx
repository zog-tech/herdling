/**
 * Keeps the session in the right place when the layout class or the route changes (see
 * `columnAction` in `layout.ts`). Regular width: a session route on top moves into the detail
 * column of Overview. Regular to compact: the selected session becomes a pushed screen.
 * Rendered once in the root layout. On a phone in portrait it never acts.
 */
import { useGlobalSearchParams, usePathname, useRootNavigationState, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { columnAction, OVERVIEW_PATH, selectionFromParams, useLayoutClass, type LayoutClass } from "./layout";

type Params = { host?: string; pane?: string; from?: string; prompt?: string; promptError?: string };

/** Only the params that have a value: an undefined param would show as "undefined" in the URL. */
function defined(params: Record<string, string | undefined>): Record<string, string> {
  return Object.fromEntries(Object.entries(params).filter((e): e is [string, string] => typeof e[1] === "string"));
}

export function LayoutSync() {
  const layout = useLayoutClass();
  const pathname = usePathname();
  const { host, pane, from, prompt, promptError } = useGlobalSearchParams<Params>();
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const previous = useRef<LayoutClass | undefined>(undefined);

  useEffect(() => {
    if (!navReady) return;
    const before = previous.current;
    previous.current = layout;
    const action = columnAction(layout, before, pathname, selectionFromParams({ host, pane }));
    if (action.type === "toColumn") {
      const { hostId, paneId } = action.pane;
      router.dismissTo({ pathname: OVERVIEW_PATH, params: defined({ host: hostId, pane: paneId, from, prompt, promptError }) } as Href);
    } else if (action.type === "toRoute") {
      const { hostId, paneId } = action.pane;
      // Clear the selection first: setParams acts on the focused route, which is Overview only before the push.
      router.setParams({ host: undefined, pane: undefined, from: undefined, prompt: undefined, promptError: undefined });
      router.push({ pathname: "/session/[hostId]/[paneId]", params: { hostId, paneId } } as Href);
    }
  }, [navReady, layout, pathname, host, pane, from, prompt, promptError, router]);

  return null;
}
