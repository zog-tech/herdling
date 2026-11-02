/**
 * Installs the crash handler when it loads. The root layout imports this module first, so the
 * handler is in place before the other modules run their start code.
 */
import { installCrashHandler } from "./globalHandler";

installCrashHandler();
