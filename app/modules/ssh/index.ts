import { NativeModule, requireNativeModule } from "expo";

export type ConnectOptions = { host: string; port: number; user: string; fingerprint?: string };

export type SshEvents = {
  /** stdout text of an exec channel, cut at UTF-8 sequence boundaries (not at lines). */
  onData: (e: { channelId: string; data: string }) => void;
  /** stderr text of an exec channel. Kept apart from stdout. */
  onStderr: (e: { channelId: string; data: string }) => void;
  /** The channel ended: "eof", "closed", "exit <code>", "connection closed" or an error text. */
  onChannelClose: (e: { channelId: string; reason: string }) => void;
  /** The SSH connection dropped. Not sent after `disconnect()`. */
  onDisconnect: (e: { hostId: string; reason: string }) => void;
};

declare class SshNativeModule extends NativeModule<SshEvents> {
  ensureKey(): Promise<{ publicKey: string }>;
  connect(hostId: string, o: ConnectOptions): Promise<{ fingerprint: string }>;
  openExec(hostId: string, command: string): Promise<string>;
  write(channelId: string, data: string): Promise<void>;
  closeChannel(channelId: string): Promise<void>;
  disconnect(hostId: string): Promise<void>;
}

const Ssh = requireNativeModule<SshNativeModule>("SshModule");

/** ed25519 key from the Keychain (made on first call). `publicKey` is an OpenSSH line ending in " zogssh". */
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

export function addListener<E extends keyof SshEvents>(event: E, listener: SshEvents[E]): { remove(): void } {
  return Ssh.addListener(event, listener);
}
