import { createContext, useContext } from "react";

/** The Claude log a thread list shows; subagent cards need it to open their own thread. */
export type ThreadLog = { hostId: string; logPath: string };

export const ThreadLogContext = createContext<ThreadLog | null>(null);

export const useThreadLog = () => useContext(ThreadLogContext);
