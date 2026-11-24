import { useLocalSearchParams, useRouter } from "expo-router";
import { Download, ExternalLink, KeyRound, LifeBuoy, Power } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Linking } from "react-native";

import { LOGIN_HINT } from "@/hosts/boot";
import { HERDR_URL, type InstallBoot } from "@/hosts/installer";
import { SetupFailed, setUpWithPassword, type SetupStep } from "@/hosts/passwordSetup";
import type { ReachFailure } from "@/hosts/sshHelp";
import { Lead, Outcome, Working } from "@/hosts/flowParts";
import { colors, icon } from "@/theme/tokens";
import { ActionBar } from "@/ui/ActionBar";
import { Field } from "@/ui/Field";
import { Group, Pad, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

/** Shows the probed host key. The password is sent only after "It matches". */
function confirmProbedKey(fingerprint: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Check the host key",
      `${fingerprint}\n\nCheck this matches the computer:\nssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\n\nIf it does not, someone on the network may be intercepting the connection.`,
      [
        { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
        { text: "It matches", onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

function portOf(text: string): number | undefined {
  const n = Number(text);
  return /^\d+$/.test(text) && n >= 1 && n <= 65535 ? n : undefined;
}

const STEP_TEXT: Record<SetupStep, string> = {
  connecting: "Connecting…",
  installing: "Installing herdlingd. If the computer has no Herdr 2, this installs it too. This can take a few minutes…",
  installing_herdr: "Installing Herdr 2 and herdlingd. This can take a few minutes…",
  pairing: "Adding this phone's key…",
};

/** The bullet lines of a question, one per line. */
function Bullets({ lines }: { lines: string[] }) {
  return <Text variant="small" muted>{lines.map((l) => `• ${l}`).join("\n")}</Text>;
}

/** The question when the installer finds no Herdr: what Herdr 2 is and who makes it. The answers are in the action bar. */
function HerdrQuestion({ address }: { address: string }) {
  return (
    <Section title="Install Herdr 2?">
      <Group>
        <Pad>
          <Text variant="headline" accessibilityRole="header">
            Herdr 2 is not on {address}
          </Text>
          <Text variant="small" muted>
            Herdr 2 is the terminal workspace that Herdling works with. Your agents run in Herdr 2 on the computer. Herdr 2
            is made by its own project, not by Zog Tech.
          </Text>
          <Text variant="small" muted>
            Herdling can install it with the same password:
          </Text>
          <Bullets
            lines={["It downloads Herdr 2 and checks its checksum.", "It installs Herdr 2 for your user only.", "It needs no admin rights and does not use sudo."]}
          />
          <Text variant="small" muted>
            Then Herdling installs herdlingd and pairs.
          </Text>
        </Pad>
        <Row
          title="About Herdr"
          leading={<ExternalLink size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
          accessibilityHint="Opens herdr.dev in the browser"
          onPress={() => void Linking.openURL(HERDR_URL)}
        />
      </Group>
    </Section>
  );
}

/** The question before the install: what happens on the computer. The answers are in the action bar. */
function InstallQuestion({ address }: { address: string }) {
  return (
    <Section title="Install herdlingd?">
      <Group>
        <Pad>
          <Text variant="headline" accessibilityRole="header">
            herdlingd is not on {address}. Install it now?
          </Text>
          <Text variant="small" muted>
            Herdling logs in with the same password and runs the herdlingd installer:
          </Text>
          <Bullets
            lines={[
              "It downloads herdlingd from the Herdling releases on GitHub and checks the checksum.",
              "It installs herdlingd to ~/.local/bin.",
              "It adds a user service (launchd on macOS, systemd on Linux).",
              "It needs no admin rights and does not use sudo.",
            ]}
          />
          <Text variant="small" muted>
            herdlingd needs Herdr 2. If Herdr 2 is not on the computer, the installer installs it first. It does not need herdr 1.
          </Text>
        </Pad>
      </Group>
    </Section>
  );
}

/**
 * "Set up with password": one password login adds this phone's key; the password is not kept.
 * When the computer has no herdlingd, the app offers to install it in the same setup.
 */
export default function PasswordSetupScreen() {
  const router = useRouter();
  // A suggested computer (Add computer, "Suggested") fills in what it knows.
  const given = useLocalSearchParams<{ name?: string; address?: string; port?: string; user?: string }>();
  const [name, setName] = useState(given.name ?? "");
  const [address, setAddress] = useState(given.address ?? "");
  const [portText, setPortText] = useState(given.port && portOf(given.port) ? given.port : "22");
  const [user, setUser] = useState(given.user ?? "");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SetupStep>();
  const [ask, setAsk] = useState<string>();
  const answer = useRef<(yes: boolean) => void>(undefined);
  const [askHerdr, setAskHerdr] = useState<string>();
  const herdrAnswer = useRef<(yes: boolean) => void>(undefined);
  const [error, setError] = useState<string>();
  const [reach, setReach] = useState<ReachFailure>();
  const [added, setAdded] = useState<{ id: string; name: string }>();

  const port = portOf(portText);
  const valid = address.trim() !== "" && user.trim() !== "" && password !== "" && port !== undefined;

  const confirmInstall = (target: { address: string }) =>
    new Promise<boolean>((resolve) => {
      answer.current = resolve;
      setAsk(target.address);
    });

  const onAnswer = (yes: boolean) => {
    setAsk(undefined);
    answer.current?.(yes);
    answer.current = undefined;
  };

  const confirmHerdrInstall = (target: { address: string }) =>
    new Promise<boolean>((resolve) => {
      herdrAnswer.current = resolve;
      setAskHerdr(target.address);
    });

  const onHerdrAnswer = (yes: boolean) => {
    setAskHerdr(undefined);
    herdrAnswer.current?.(yes);
    herdrAnswer.current = undefined;
  };

  const connect = async () => {
    if (!valid || busy || port === undefined) return;
    setBusy(true);
    setError(undefined);
    setReach(undefined);
    let boot: InstallBoot | undefined;
    try {
      const host = await setUpWithPassword({
        name,
        address,
        port,
        user,
        password,
        confirm: confirmProbedKey,
        confirmInstall,
        confirmHerdrInstall,
        onInstalled: (r) => {
          boot = r.boot;
        },
        onProgress: setStep,
      });
      // The install says herdlingd starts only after a login: tell the user once.
      if (boot === "login") setAdded({ id: host.id, name: host.name });
      else router.dismissTo("/");
    } catch (e) {
      setError(e instanceof SetupFailed ? e.message : "Setup failed. Nothing was saved.");
      setReach(e instanceof SetupFailed ? e.reach : undefined);
    } finally {
      // The password is used for this one setup only.
      setPassword("");
      setBusy(false);
      setStep(undefined);
      setAsk(undefined);
      setAskHerdr(undefined);
    }
  };

  // After the setup: herdlingd starts only after a login on the computer. Shown once.
  if (added) {
    return (
      <Screen flush footer={<ActionBar primary={{ label: "Done", onPress: () => router.dismissTo("/") }} />}>
        <Section title={`${added.name} is added`}>
          <Group>
            <Pad>
              <StateNotice inline Icon={Power} message={LOGIN_HINT} />
              <Text variant="small" muted>
                After a restart, herdlingd starts only when you log in on {added.name}. You can make it start at boot.
              </Text>
            </Pad>
            <Row
              title="How to start at boot"
              chevron
              onPress={() => router.push({ pathname: "/hosts/boot-help", params: { id: added.id } })}
            />
          </Group>
        </Section>
      </Screen>
    );
  }

  // While a question is open, the action bar holds its two answers.
  const footer = askHerdr ? (
    <ActionBar
      primary={{ label: "Install Herdr 2 and herdlingd", Icon: Download, onPress: () => onHerdrAnswer(true) }}
      secondary={{ label: "Cancel", onPress: () => onHerdrAnswer(false) }}
    />
  ) : ask ? (
    <ActionBar
      primary={{ label: "Install and pair", Icon: Download, onPress: () => onAnswer(true) }}
      secondary={{ label: "Cancel", onPress: () => onAnswer(false) }}
    />
  ) : (
    <ActionBar keyboard primary={{ label: "Connect", Icon: KeyRound, loading: busy, disabled: !valid, onPress: () => void connect() }} />
  );

  return (
    <Screen flush footer={footer}>
      {askHerdr ? <HerdrQuestion address={askHerdr} /> : null}
      {ask ? <InstallQuestion address={ask} /> : null}
      {ask || askHerdr ? null : (
        <Lead>
          For a computer that allows SSH password login. Herdling logs in once, installs herdlingd if it is not there, adds
          its own key, and does not keep the password.
        </Lead>
      )}
      <Section title="Computer">
        <Group>
          <Pad>
            <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="Studio" editable={!busy} />
            <Field label="Host" value={address} onChangeText={setAddress} placeholder="10.0.0.5" keyboardType="url" editable={!busy} />
            <Field
              label="Port"
              value={portText}
              onChangeText={(t) => setPortText(t.replace(/\D/g, "").slice(0, 5))}
              keyboardType="number-pad"
              mono
              editable={!busy}
            />
            {portText !== "" && port === undefined ? (
              <Text variant="small" color={colors.danger} accessibilityLiveRegion="polite">
                Port must be 1 to 65535.
              </Text>
            ) : null}
          </Pad>
        </Group>
      </Section>
      <Section title="Login" footer="The password is used for this setup only.">
        <Group>
          <Pad>
            <Field label="User" value={user} onChangeText={setUser} placeholder="sam" editable={!busy} />
            <Field
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              textContentType="password"
              autoComplete="off"
              importantForAutofill="no"
              editable={!busy}
              onSubmitEditing={() => void connect()}
            />
          </Pad>
        </Group>
      </Section>
      {busy && step && !ask && !askHerdr ? <Working text={STEP_TEXT[step]} /> : null}
      {error ? <Outcome ok={false} text={error} /> : null}
      {error && (error.includes(HERDR_URL) || reach) ? (
        <Section title="Help">
          <Group>
            {error.includes(HERDR_URL) ? (
              <Row
                title="Open herdr.dev"
                leading={<ExternalLink size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
                onPress={() => void Linking.openURL(HERDR_URL)}
              />
            ) : null}
            {reach ? (
              <Row
                title="Turn on SSH on the computer"
                leading={<LifeBuoy size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
                chevron
                onPress={() =>
                  router.push({
                    pathname: "/hosts/ssh-help",
                    params: { address: address.trim(), port: String(port ?? 22), user: user.trim(), kind: reach },
                  })
                }
              />
            ) : null}
          </Group>
        </Section>
      ) : null}
    </Screen>
  );
}
