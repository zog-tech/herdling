/**
 * Installs the crash handler when it loads. The root layout imports this module first, so the
 * handler is in place before the other modules run their start code. It also moves a native crash
 * from the last run into the crash log.
 */
import { installCrashHandler } from "./globalHandler";
import { importNativeCrash } from "./nativeCrash";

installCrashHandler();
void importNativeCrash();
