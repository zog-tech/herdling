import { MAC_OPEN_SETTINGS, type Step } from "./steps";

/**
 * Why the phone could not open an SSH connection to the port.
 * - `refused`: the computer answered, but nothing listens on the port. Usually SSH (Remote Login) is off.
 * - `no_route`: the phone cannot find or reach the computer (other network, wrong address).
 * - `no_answer`: no answer in time (other network, firewall, the computer sleeps).
 * - `other`: the connection failed for another reason.
 */
export type ReachFailure = "refused" | "no_route" | "no_answer" | "other";

const REFUSED = /refused|ECONNREFUSED/i;
const NO_ROUTE =
  /no route|unreachable|network is down|EHOSTUNREACH|ENETUNREACH|ENETDOWN|unknown ?host|nodename|could not resolve|name resolution|NXDOMAIN|no address/i;
const NO_ANSWER = /timed? ?out|timeout|ETIMEDOUT/i;

/**
 * Reads a native ssh error (`modules/ssh`): `connect_failed` with the platform text, or `timeout`.
 * Null for an error that is not about reaching the port (for example `auth_failed`).
 */
export function reachFailure(code: unknown, text: string): ReachFailure | null {
  if (code === "timeout") return "no_answer";
  if (code !== "connect_failed") return null;
  if (REFUSED.test(text)) return "refused";
  if (NO_ROUTE.test(text)) return "no_route";
  if (NO_ANSWER.test(text)) return "no_answer";
  return "other";
}

/** One sentence about the failure, above the steps. */
export function reachLead(kind: ReachFailure | undefined, target: string): string {
  switch (kind) {
    case "refused":
      return `${target} answered, but SSH is off on it. Turn on SSH (Remote Login on a Mac).`;
    case "no_route":
      return `The phone cannot find ${target}. Check the address, and that the phone and the computer are on the same network or VPN.`;
    case "no_answer":
      return `${target} did not answer. The computer may be on another network, asleep, or SSH is off.`;
    default:
      return `The phone could not open an SSH connection to ${target}. SSH may be off on the computer.`;
  }
}

/** Steps to turn on Remote Login on macOS 13 and later (Ventura, Sonoma, Sequoia, Tahoe). */
export function macRemoteLoginSteps(user?: string): Step[] {
  const who = user ? `"${user}"` : "your user";
  return [
    { text: MAC_OPEN_SETTINGS },
    { text: "In the sidebar, click General." },
    { text: "Click Sharing." },
    { text: "Turn on Remote Login. If macOS asks, enter the password of the Mac." },
    { text: "Click the info button (i) next to Remote Login." },
    {
      text: `At "Allow access for", choose "All users". Or choose "Only these users" and make sure ${who} is in the list. To add a user, click +.`,
    },
    {
      text: 'Leave "Allow full disk access for remote users" off. Herdling does not need it.',
    },
    {
      text: 'Click Done. Under Remote Login, macOS shows "ssh user@address". Use that address in Herdling if the one you typed does not work.',
    },
  ];
}

/** Steps to install and start the SSH server on Linux. The commands differ by distribution. */
export function linuxSshSteps(): Step[] {
  return [
    { text: "Open a terminal on the computer." },
    { text: "Install the SSH server. Debian and Ubuntu:", command: "sudo apt install openssh-server" },
    { text: "Fedora:", command: "sudo dnf install openssh-server" },
    { text: "Arch:", command: "sudo pacman -S openssh" },
    { text: "Start it now and at each boot. Debian and Ubuntu:", command: "sudo systemctl enable --now ssh" },
    { text: "Fedora and Arch:", command: "sudo systemctl enable --now sshd" },
    { text: "If the ufw firewall is on, let SSH in:", command: "sudo ufw allow ssh" },
  ];
}

/** The last step for both systems. */
export const NETWORK_STEP: Step = {
  text: "Check that the phone and the computer are on the same network (the same Wi-Fi) or on the same VPN.",
};
