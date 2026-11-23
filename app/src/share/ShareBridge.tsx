/**
 * Takes each share from another app and opens the share screen. Renders nothing. It is in the root
 * layout, so a share arrives on every screen, also at a cold start.
 *
 * iOS: the share extension opens `herdling://dataUrl=…`. `+native-intent.tsx` sends that link to
 * `/share`, and this bridge asks the module for the data of the link. Android: the bridge asks at
 * start and each time the app comes back to the front; a share while the app runs comes as a new intent.
 * On a binary without the native module, nothing happens.
 */
import { useRootNavigationState, usePathname, useRouter } from "expo-router";
import { useEffect, useRef } from "react";
import { AppState, Linking } from "react-native";

import { logDisplay } from "@/ui/displayLog";
import { showNotice } from "@/ui/notice";

import { isEmpty, parseShare } from "./content";
import { addShareListener, clearShare, hasShareIntent, requestShare } from "./native";
import { receiveShare } from "./shareStore";

export const SHARE_ROUTE = "/share";
export const NOTHING_TO_SHARE = "Nothing that Herdling can send was shared.";

export function ShareBridge() {
  const router = useRouter();
  const navReady = !!useRootNavigationState()?.key;
  const path = useRef("");
  path.current = usePathname();

  useEffect(() => {
    if (!hasShareIntent || !navReady) return;
    const off = addShareListener(
      (value) => {
        // Forget it on the native side at once: the next return to the app must not bring it again.
        clearShare();
        const content = parseShare(value);
        if (!content || isEmpty(content)) {
          logDisplay("share: no content");
          showNotice(NOTHING_TO_SHARE, { failed: true });
          if (path.current === SHARE_ROUTE) {
            if (router.canGoBack()) router.back();
            else router.replace("/");
          }
          return;
        }
        receiveShare(content);
        if (path.current !== SHARE_ROUTE) router.push(SHARE_ROUTE);
      },
      (message) => logDisplay(`share: ${message}`),
    );
    Linking.getInitialURL()
      .then((url) => requestShare(url))
      .catch(() => {});
    const link = Linking.addEventListener("url", ({ url }) => requestShare(url));
    const app = AppState.addEventListener("change", (s) => {
      // Android only: iOS reads a share from its link, not on each return.
      if (s === "active") requestShare(null);
    });
    return () => {
      off();
      link.remove();
      app.remove();
    };
  }, [navReady, router]);

  return null;
}
