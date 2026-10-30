export type AgentStatus = "idle" | "working" | "blocked" | "done" | "unknown";

export type RpcRequest = { id: number; method: string; params?: unknown };
export type RpcError = { code: string; message: string };
export type RpcResponse = { id: number; result?: unknown; error?: RpcError };
export type RpcEvent = { method: "event"; params: { stream: string; data: unknown } };

export type Hello = {
  host: string;
  os: "macos" | "linux";
  zogsshd: string;
  herdr_ok: boolean;
  herdr_version?: string;
  herdr_protocol?: number;
};

export type ThreadItem =
  | { kind: "user"; id: string; ts: number; text: string; images?: number }
  | { kind: "assistant"; id: string; ts: number; markdown: string }
  | { kind: "thinking"; id: string; ts: number; text: string | null }
  | {
      kind: "tool";
      id: string;
      ts: number;
      name: string;
      input_summary: string;
      input: unknown;
      result?: { ok: boolean; text: string; truncated: boolean };
    }
  | {
      kind: "subagent";
      id: string;
      ts: number;
      agent_id: string;
      description: string;
      status: string;
      result_summary?: string;
    }
  | { kind: "system"; id: string; ts: number; text: string };

/** cursor = byte offset for the older page (null at file start); end = file size at read time, used as thread.follow `from`. */
export type ThreadPage = { items: ThreadItem[]; cursor: number | null; end: number };
export type ThreadRef = { kind: string; session: string | null; log_path: string | null; cwd: string | null };
export type RecentSession = { session: string; first_prompt: string; last_activity: number; cwd: string };

export type PushPrefs = { finished: boolean; needs_you: boolean };
export type PushRegister = {
  device_id: string;
  host_id: string;
  name: string;
  expo_token: string | null;
  prefs: PushPrefs;
};

export type PairRequest = {
  code: string;
  device_id: string;
  device_name: string;
  host_id: string;
  public_key: string;
  expo_token: string | null;
};
export type PairResponse = {
  host_name: string;
  user: string;
  ssh_port: number;
  host_key_fingerprint: string | null;
};
