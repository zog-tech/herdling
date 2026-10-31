/** Default location of the companion binary, relative to the host user's home. */
const BIN_DIR = "/.local/bin/";

/**
 * Shell command the user runs on the host to authorize the phone key.
 * The line is restricted to the companion command. `$HOME` expands in the host shell
 * (the `command=` option needs an absolute path), the rest stays in single quotes.
 * A command that starts with `herdlingd` gets the `$HOME/.local/bin/` prefix; an absolute path is used as is.
 */
export function authorizedKeysCommand(publicKey: string, command = "herdlingd rpc"): string {
  const c = command.trim() || "herdlingd rpc";
  const path = c.startsWith("/") ? c : `'"$HOME"'${BIN_DIR}${c}`;
  return `echo 'restrict,command="${path}" ${publicKey}' >> ~/.ssh/authorized_keys`;
}
