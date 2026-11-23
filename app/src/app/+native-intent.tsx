/**
 * Rewrites a link from the system before Expo Router opens it. The iOS share extension opens
 * `herdling://dataUrl=herdlingShareKey#media`, which is not a route: it goes to the share screen,
 * and the share bridge reads the shared data. Every other link stays as it is.
 */
import { isShareUrl } from "@/share/native";

export function redirectSystemPath({ path }: { path: string; initial: boolean }): string {
  try {
    if (isShareUrl(path) || /^\/?dataUrl=/i.test(path)) return "/share";
  } catch {
    // Keep the link as it is.
  }
  return path;
}
