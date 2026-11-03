import { createContext, useContext } from "react";

/**
 * The Claude log a thread list shows; subagent cards need it to open their own thread. `paneId`:
 * the pane of the agent that writes the log, so a subagent thread can run commands in its folder.
 */
export type ThreadLog = { hostId: string; logPath: string; paneId?: string };

export const ThreadLogContext = createContext<ThreadLog | null>(null);

export const useThreadLog = () => useContext(ThreadLogContext);
