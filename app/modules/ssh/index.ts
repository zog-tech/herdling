import { NativeModule, requireNativeModule } from "expo";

export type ConnectOptions = { host: string; port: number; user: string; fingerprint?: string };

/** One-shot password login for "Set up with password". The password is never stored or logged. */
export type PasswordExecOptions = {
  host: string;
  port: number;
  user: string;
  password: string;
  command: string;
  /** Written to the command's stdin after it starts. stdin is not closed, so end it with a newline. */
  stdin: string;
  /** When given, a different host key rejects with "host_key_mismatch" before the password is sent. */
  expectedFingerprint?: string;
  timeoutMs: number;
};

export type PasswordExecResult = { stdout: string; stderr: string; exitCode: number; hostFingerprint: string };

/** A `_herdling._tcp` service seen on the local network. `address` is null when it did not resolve in 3 s. */
export type FoundService = { name: string; address: string | null; pairPort: number; txt: Record<string, string> };

/** State of the Bonjour browse. "waiting" is what iOS reports when local network access is denied. */
export type BrowseState = { state: "ready" | "waiting" | "failed" | "stopped"; error?: string };

export type SshEvents = {
  /** stdout text of an exec channel, cut at UTF-8 sequence boundaries (not at lines). */
  onData: (e: { channelId: string; data: string }) => void;
  /** stderr text of an exec channel. Kept apart from stdout. */
  onStderr: (e: { channelId: string; data: string }) => void;
  /** The channel ended: "eof", "closed", "exit <code>", "connection closed" or an error text. */
  onChannelClose: (e: { channelId: string; reason: string }) => void;
  /** The SSH connection dropped. Not sent after `disconnect()`. */
  onDisconnect: (e: { hostId: string; reason: string }) => void;
  /** A Bonjour service was found (or found again with new data) while browsing. */
  onServiceFound: (e: FoundService) => void;
  /** A Bonjour service went away while browsing. */
  onServiceLost: (e: { name: string }) => void;
  /** The browse changed state. After "failed" the browse is stopped. */
  onBrowseState: (e: BrowseState) => void;
};

declare class SshNativeModule extends NativeModule<SshEvents> {
  ensureKey(): Promise<{ publicKey: string }>;
  connect(hostId: string, o: ConnectOptions): Promise<{ fingerprint: string }>;
  openExec(hostId: string, command: string): Promise<string>;
  write(channelId: string, data: string): Promise<void>;
  closeChannel(channelId: string): Promise<void>;
  disconnect(hostId: string): Promise<void>;
  probeHostKey(o: { host: string; port: number; timeoutMs: number }): Promise<{ fingerprint: string }>;
  execWithPassword(o: PasswordExecOptions): Promise<PasswordExecResult>;
  startBrowse(): Promise<void>;
  stopBrowse(): Promise<void>;
  /** Builds before the browser preview do not have these two functions. */
  startPreview?(hostId: string, port: number, command: string): Promise<{ localPort: number }>;
  stopPreview?(localPort: number): Promise<void>;
}

const Ssh = requireNativeModule<SshNativeModule>("SshModule");

/** ed25519 key from the Keychain (made on first call). `publicKey` is an OpenSSH line ending in " herdling". */
export function ensureKey(): Promise<{ publicKey: string }> {
  return Ssh.ensureKey();
}

/**
 * Opens the SSH connection for `hostId` (replaces an open one).
 * Without `fingerprint` any host key is accepted and returned (`SHA256:<base64>`).
 * With `fingerprint` a different key rejects with code "host_key_mismatch".
 * Other error codes: "auth_failed", "connect_failed".
 */
export function connect(hostId: string, o: ConnectOptions): Promise<{ fingerprint: string }> {
  return Ssh.connect(hostId, o);
}

/** Runs `command` on an exec channel. Returns the channel id. */
export function openExec(hostId: string, command: string): Promise<string> {
  return Ssh.openExec(hostId, command);
}

/** Writes text to the channel's stdin, in call order. */
export function write(channelId: string, data: string): Promise<void> {
  return Ssh.write(channelId, data);
}

export function closeChannel(channelId: string): Promise<void> {
  return Ssh.closeChannel(channelId);
}

export function disconnect(hostId: string): Promise<void> {
  return Ssh.disconnect(hostId);
}

/**
 * Reads the host key (`SHA256:<base64>`) and closes the connection before any login.
 * Error codes: "connect_failed", "timeout".
 */
export function probeHostKey(o: { host: string; port: number; timeoutMs: number }): Promise<{ fingerprint: string }> {
  return Ssh.probeHostKey(o);
}

/**
 * Logs in with a password, runs `command` on one exec channel, writes `stdin`, collects the output
 * until the command ends, then disconnects. Not tied to a saved host. A non-zero exit is a result, not an error.
 * Error codes: "host_key_mismatch", "auth_failed", "connect_failed", "exec_failed", "timeout".
 */
export function execWithPassword(o: PasswordExecOptions): Promise<PasswordExecResult> {
  return Ssh.execWithPassword(o);
}

/** Starts browsing for `_herdling._tcp` services (replaces a running browse). Results come as events. */
export function startBrowse(): Promise<void> {
  return Ssh.startBrowse();
}

export function stopBrowse(): Promise<void> {
  return Ssh.stopBrowse();
}

export function addListener<E extends keyof SshEvents>(event: E, listener: SshEvents[E]): { remove(): void } {
  return Ssh.addListener(event, listener);
}

/**
 * True when this build has the browser preview proxy. Builds before it do not have
 * `startPreview`: an OTA update must hide the preview there.
 */
export function hasNativePreview(): boolean {
  return typeof Ssh?.startPreview === "function" && typeof Ssh?.stopPreview === "function";
}

/**
 * Starts the preview proxy for one port of a host: a listener on `127.0.0.1` of the phone, first
 * on the same port number, else on a free port. Each accepted connection opens an exec channel
 * with `command` (`herdlingd proxy <port> <grant>`) on the host's SSH connection and copies raw bytes.
 * A connection without the preview cookie gets 403. The module puts the cookie in the web view
 * cookie store before it resolves. Error codes: "not_supported", "not_connected", "listen_failed".
 */
export function startPreview(hostId: string, port: number, command: string): Promise<{ localPort: number }> {
  if (!Ssh.startPreview) return Promise.reject(Object.assign(new Error("This build has no browser preview"), { code: "not_supported" }));
  return Ssh.startPreview(hostId, port, command);
}

/** Stops the listener and closes its proxy channels. Unknown ports are ignored. */
export function stopPreview(localPort: number): Promise<void> {
  return Ssh.stopPreview ? Ssh.stopPreview(localPort) : Promise.resolve();
}
