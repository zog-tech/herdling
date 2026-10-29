/** Path of the companion binary on the host, relative to the host user's home. */
const BIN = "/.local/bin/zogsshd rpc";

/**
 * Shell command the user runs on the host to authorize the phone key.
 * The line is restricted to the companion `rpc` command. `$HOME` expands in the host shell
 * (the `command=` option needs an absolute path), the rest stays in single quotes.
 */
export function authorizedKeysCommand(publicKey: string): string {
  return `echo 'restrict,command="'"$HOME"'${BIN}" ${publicKey}' >> ~/.ssh/authorized_keys`;
}
