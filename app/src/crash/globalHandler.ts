/**
 * The global JavaScript error handler. A fatal error (an error in a render with no error screen
 * above it, or an error thrown in a timer) closes the app. Before that, this handler writes the
 * message and the stack to the crash log, then calls the handler that was there before.
 */
import * as Updates from "expo-updates";

import { recordCrash, type CrashContext } from "./crashLog";

type Handler = (error: unknown, isFatal?: boolean) => void;
type ErrorUtilsLike = { getGlobalHandler: () => Handler; setGlobalHandler: (h: Handler) => void };

let route: string | undefined;

/** The root layout calls this on each route change, so a crash entry tells where the app was. */
export function setCrashRoute(path: string | undefined): void {
  route = path;
}

/** The update that runs: the first 8 characters of its id, or "built-in" for the code of the build. */
function updateLabel(): string | undefined {
  try {
    return Updates.isEmbeddedLaunch || !Updates.updateId ? "built-in" : Updates.updateId.slice(0, 8);
  } catch {
    return undefined;
  }
}

/** The route and the update for a crash entry. */
export function crashContext(): CrashContext {
  return { route, update: updateLabel() };
}

let installed = false;

/**
 * Wraps the current global handler once. The previous handler still runs for every error, so the
 * red screen in development and the native crash report in a release build stay as they were.
 */
export function installCrashHandler(utils: ErrorUtilsLike | undefined = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils): void {
  if (installed || !utils) return;
  installed = true;
  const previous = utils.getGlobalHandler();
  utils.setGlobalHandler((error, isFatal) => {
    if (isFatal) recordCrash(error, "fatal", crashContext());
    previous(error, isFatal);
  });
}
