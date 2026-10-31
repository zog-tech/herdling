import { useRouter } from "expo-router";
import { Download, ExternalLink, KeyRound } from "lucide-react-native";
import { useRef, useState } from "react";
import { Alert, Linking, View } from "react-native";

import { HERDR_URL } from "@/hosts/installer";
import { SetupFailed, setUpWithPassword, type SetupStep } from "@/hosts/passwordSetup";
import { colors, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import { DelayedSpinner } from "@/ui/Delayed";
import { Field } from "@/ui/Field";
import { Screen } from "@/ui/Screen";
import { Text } from "@/ui/Text";

/** Shows the probed host key. The password is sent only after "It matches". */
function confirmProbedKey(fingerprint: string): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      "Check the host key",
      `${fingerprint}\n\nCheck this matches the host:\nssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub\n\nIf it does not, someone on the network may be intercepting the connection.`,
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
  installing: "Installing herdlingd. This can take a minute…",
  pairing: "Adding this phone's key…",
};

/** The question before the install: what happens on the computer, and two answers. */
function InstallQuestion({ address, onAnswer }: { address: string; onAnswer: (yes: boolean) => void }) {
  return (
    <Card>
      <Text variant="headline" accessibilityRole="header">
        herdlingd is not on {address}. Install it now?
      </Text>
      <Text variant="small" muted>
        Herdling logs in with the same password and runs the herdlingd installer:
      </Text>
      <Text variant="small" muted>
        • It downloads herdlingd from the Herdling releases on GitHub and checks the checksum.{"\n"}• It installs
        herdlingd to ~/.local/bin.{"\n"}• It adds a user service (launchd on macOS, systemd on Linux).{"\n"}• It needs
        no admin rights and does not use sudo.
      </Text>
      <Text variant="small" muted>
        herdr must be on the computer already.
      </Text>
      <View style={{ gap: space.sm }}>
        <Button label="Install and pair" Icon={Download} onPress={() => onAnswer(true)} />
        <Button label="Cancel" variant="secondary" onPress={() => onAnswer(false)} />
      </View>
    </Card>
  );
}

/**
 * "Set up with password": one password login adds this phone's key; the password is not kept.
 * When the computer has no herdlingd, the app offers to install it in the same setup.
 */
export default function PasswordSetupScreen() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [portText, setPortText] = useState("22");
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<SetupStep>();
  const [ask, setAsk] = useState<string>();
  const answer = useRef<(yes: boolean) => void>(undefined);
  const [error, setError] = useState<string>();

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

  const connect = async () => {
    if (!valid || busy || port === undefined) return;
    setBusy(true);
    setError(undefined);
    try {
      await setUpWithPassword({ name, address, port, user, password, confirm: confirmProbedKey, confirmInstall, onProgress: setStep });
      router.dismissTo("/");
    } catch (e) {
      setError(e instanceof SetupFailed ? e.message : "Setup failed. Nothing was saved.");
    } finally {
      // The password is used for this one setup only.
      setPassword("");
      setBusy(false);
      setStep(undefined);
      setAsk(undefined);
    }
  };

  return (
    <Screen>
      <Card>
        <Text variant="small" muted>
          For a computer that allows SSH password login. Herdling logs in once, installs herdlingd if it is not there,
          adds its own key, and does not keep the password.
        </Text>
        <Field label="Name (optional)" value={name} onChangeText={setName} placeholder="Studio" editable={!busy} />
        <Field
          label="Host"
          value={address}
          onChangeText={setAddress}
          placeholder="10.0.0.5"
          keyboardType="url"
          editable={!busy}
        />
        <Field
          label="Port"
          value={portText}
          onChangeText={(t) => setPortText(t.replace(/\D/g, "").slice(0, 5))}
          keyboardType="number-pad"
          mono
          editable={!busy}
        />
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
        {portText !== "" && port === undefined ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            Port must be 1 to 65535.
          </Text>
        ) : null}
        {error ? (
          <Text color={colors.danger} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        {error?.includes(HERDR_URL) ? (
          <Button label="Open herdr.dev" variant="secondary" Icon={ExternalLink} onPress={() => void Linking.openURL(HERDR_URL)} />
        ) : null}
      </Card>
      {ask ? <InstallQuestion address={ask} onAnswer={onAnswer} /> : null}
      {busy && step && !ask ? (
        <View accessibilityLiveRegion="polite" style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
          <DelayedSpinner color={colors.textMuted} />
          <Text muted style={{ flex: 1 }}>
            {STEP_TEXT[step]}
          </Text>
        </View>
      ) : null}
      {ask ? null : (
        <View style={{ gap: space.md }}>
          <Button label="Connect" Icon={KeyRound} loading={busy} disabled={!valid} onPress={() => void connect()} />
        </View>
      )}
    </Screen>
  );
}
