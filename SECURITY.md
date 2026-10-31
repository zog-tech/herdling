# Security policy

## Report a problem

Please report a security problem in private. Do not open a public issue, a discussion or a pull request for it.

Write to [admin@zog-tech.com](mailto:admin@zog-tech.com). Use the subject "Herdling security".
When the repository is public, you can also use GitHub private vulnerability reporting: open the
**Security** tab of this repository and choose **Report a vulnerability**.

Please include:

- what the problem is and what it can do
- the platform and the app version (iPhone or Android, with the build number)
- the `herdlingd` version and the computer's operating system, if it matters
- the steps to repeat it, or a small proof of concept

Do not send passwords, private keys, push tokens or the sessions of other people.

## What to expect

- We reply within 5 working days.
- We tell you when we confirm the problem, and we keep you up to date.
- We fix confirmed problems as fast as we can, and we publish a fixed version.
- We credit you in the release notes if you want. Tell us how you want to be named.

This is a small project. We cannot pay bounties.

## Supported versions

Only the latest release gets security fixes.

| Version | Fixes |
|---|---|
| Latest app release and latest `herdlingd` | Yes |
| Older releases | No. Update to the latest release. |

## Scope

In scope:

- The Herdling app code in this repository (`app/`), with its native modules (`app/modules/`)
- `herdlingd` (`companion/`): the RPC, the pairing window and endpoint, `enroll`, the
  `authorized_keys` lines it writes, the install command and the user service
- The SSH key and host key handling on the phone, and the data the app stores
- The push messages that `herdlingd` sends

Out of scope:

- Problems in herdr, in the coding agents or in your SSH server. Report them to that project.
- Problems in Expo, React Native, Citadel, sshj or another library with no effect on Herdling.
  Report them to that project. If Herdling is affected, tell us too.
- Problems that need a phone or a computer that is already unlocked and in the hands of the attacker

## Safe harbor

If you act in good faith, follow this policy and do not harm other people or their data,
we will not take legal action against you.
