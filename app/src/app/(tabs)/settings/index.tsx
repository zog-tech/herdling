import Constants from "expo-constants";
import { useRouter } from "expo-router";
import * as Updates from "expo-updates";
import * as Speech from "expo-speech";
import { Check, Minus, Play, Plus } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Platform, Pressable, View } from "react-native";

import { AppearanceSection } from "@/board/AppearanceSection";
import { DemoTag } from "@/demo/DemoTag";
import { DEMO_HOST_DETAIL, isDemoHost, startDemo } from "@/demo/demoHost";
import { PHONE, PHONE_LABEL } from "@/device";
import { LOGIN_HINT, startsAtLogin } from "@/hosts/boot";
import { connLabel, ConnStatus, hostDetail } from "@/hosts/ConnBadge";
import { useHostConn } from "@/hosts/connection";
import { confirmRemoveHost } from "@/hosts/removeHost";
import { useHosts, type Host } from "@/hosts/store";
import { updateStatus } from "@/hosts/updates";
import { useNotifPrefs, type NotifPref } from "@/push/prefs";
import { colors, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";
import { useVoiceSettings } from "@/voice/settings";
import { testVoice } from "@/voice/useSpeakReplies";
import { VoiceInputSection } from "@/voice/VoiceInputSettings";
import { accentOf, deviceVoices, voiceLabel } from "@/voice/voiceList";

/** "1.0.0 · update 488f5e09, Oct 31" or "1.0.0 · built-in code". Tells which code the phone runs. */
function versionText(): string {
  const version = Constants.expoConfig?.version ?? "?";
  if (Updates.isEmbeddedLaunch || !Updates.updateId) return `${version} · built-in code`;
  const day = Updates.createdAt ? `, ${Updates.createdAt.toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : "";
  return `${version} · update ${Updates.updateId.slice(0, 8)}${day}`;
}

function HostRow({ host }: { host: Host }) {
  const router = useRouter();
  const conn = useHostConn(host.id);
  const demo = isDemoHost(host);
  const update = updateStatus(host, conn.status === "online" ? conn.hello : undefined);
  const updateText = update.kind === "available" ? `Update available: ${update.from} → ${update.to}` : undefined;
  const hello = conn.status === "online" ? conn.hello : undefined;
  // A quiet state line: herdr down first, then "starts after you log in".
  const stateText = demo || !hello ? undefined : !hello.herdr_ok ? "herdr is not running" : startsAtLogin(hello) ? LOGIN_HINT : undefined;
  const detailText = updateText ?? stateText;
  return (
    <Row
      accessibilityLabel={
        demo
          ? `${host.name}, demo host, ${connLabel(conn.status)}. Open demo`
          : `${host.name}, ${connLabel(conn.status)}${detailText ? `, ${detailText}` : ""}. Edit host`
      }
      accessibilityActions={[{ name: "remove", label: demo ? "Remove demo" : `Remove ${host.name}` }]}
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "remove") confirmRemoveHost(host);
      }}
      onPress={() => router.push({ pathname: "/hosts/[id]", params: { id: host.id } })}
      title={host.name}
      detail={demo ? DEMO_HOST_DETAIL : (detailText ?? hostDetail(host, conn.status, conn.lastSeen))}
      trailing={
        demo ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
            <DemoTag />
            <ConnStatus status={conn.status} />
          </View>
        ) : (
          <ConnStatus status={conn.status} />
        )
      }
      chevron
    />
  );
}

/** Android has no push groups and no passive pushes: the row says so. */
const IOS_ONLY = Platform.OS === "ios" ? undefined : "Only on iPhone and iPad.";

function PrefRow({ pref, label, detail }: { pref: NotifPref; label: string; detail: string }) {
  const value = useNotifPrefs((s) => s[pref]);
  const setPref = useNotifPrefs((s) => s.setPref);
  return <Row title={label} detail={detail} trailing={<GoldSwitch label={label} value={value} onValueChange={(v) => setPref(pref, v)} />} />;
}

const RATE_STEP = 0.1;
const RATE_MIN = 0.5;
const RATE_MAX = 2;

/** Voices for the device language: its region first, then enhanced (see `deviceVoices`). */
function useDeviceVoices(): Speech.Voice[] {
  const [voices, setVoices] = useState<Speech.Voice[]>([]);
  useEffect(() => {
    let live = true;
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    Speech.getAvailableVoicesAsync()
      .then((all) => {
        if (live) setVoices(deviceVoices(all, locale));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return voices;
}

/** A small round step button (−, +) for the speed. Filled, no edge. */
function StepButton({ label, Icon, onPress, disabled }: { label: string; Icon: typeof Plus; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
      style={{
        width: hitTarget,
        height: hitTarget,
        alignItems: "center",
        justifyContent: "center",
        opacity: disabled ? state.disabledOpacity : 1,
      }}
    >
      {({ pressed }) => (
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.pill,
            alignItems: "center",
            justifyContent: "center",
            backgroundColor: pressed ? colors.divider : colors.raised,
          }}
        >
          <Icon size={icon.sm} color={colors.text} strokeWidth={icon.strokeWidth} />
        </View>
      )}
    </Pressable>
  );
}

const MODES = [
  { id: "full", label: "Full text" },
  { id: "summary", label: "Summary" },
] as const;
const ENGINES = [
  { id: "iphone", label: PHONE_LABEL },
  { id: "host", label: "Host" },
] as const;

function VoiceSection() {
  const { ttsDefault, mode, engine, voice, rate, set } = useVoiceSettings();
  const voices = useDeviceVoices();
  const [picking, setPicking] = useState(false);
  const current = voices.find((v) => v.identifier === voice);
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  const setRate = (r: number) => set({ rate: Math.round(Math.min(RATE_MAX, Math.max(RATE_MIN, r)) * 10) / 10 });
  const pick = (id: string | undefined) => {
    haptics.tap();
    set({ voice: id });
    setPicking(false);
  };
  return (
    <Section title="Voice">
      <Group>
        <Row
          title="Speak replies"
          detail="Read replies aloud in new sessions. Each session has its own speaker button."
          trailing={<GoldSwitch label="Speak replies by default" value={ttsDefault} onValueChange={(v) => set({ ttsDefault: v })} />}
        />
        <Row
          title="What to read"
          detail={
            mode === "summary"
              ? "A short summary: on-device (Apple Intelligence), then a host command, then the full text."
              : "The full reply, as the agent wrote it."
          }
          below={<Segmented options={MODES} value={mode} onChange={(m) => set({ mode: m })} label="What to read" />}
        />
        <Row
          title="Voice engine"
          detail={engine === "host" ? `The host's voice command (tts_command). Falls back to ${PHONE} voices.` : `The voices on this ${PHONE}.`}
          below={<Segmented options={ENGINES} value={engine} onChange={(e) => set({ engine: e })} label="Voice engine" />}
        />
        <Row
          accessibilityLabel={`Voice, ${current ? voiceLabel(current) : "System default"}`}
          accessibilityHint={picking ? "Hides the list of voices" : "Shows the list of voices"}
          onPress={() => setPicking((p) => !p)}
          title="Voice"
          trailing={
            <Text variant="small" muted numberOfLines={1} style={{ maxWidth: 180 }}>
              {current ? voiceLabel(current) : "System default"}
            </Text>
          }
          chevron
        />
        {picking ? (
          <Row
            accessibilityLabel="System default voice"
            onPress={() => pick(undefined)}
            title="System default"
            trailing={voice === undefined ? <Check size={icon.md} color={colors.accent} accessibilityLabel="Selected" /> : null}
          />
        ) : null}
        {picking
          ? voices.map((v) => (
              <Row
                key={v.identifier}
                accessibilityLabel={`Voice ${v.name}${accentOf(v.language) ? `, ${accentOf(v.language)} English` : ""}`}
                onPress={() => pick(v.identifier)}
                title={voiceLabel(v)}
                detail={v.quality === Speech.VoiceQuality.Enhanced ? "Enhanced" : undefined}
                trailing={v.identifier === voice ? <Check size={icon.md} color={colors.accent} accessibilityLabel="Selected" /> : null}
              />
            ))
          : null}
        <Row
          title="Speed"
          trailing={
            <View style={{ flexDirection: "row", alignItems: "center" }}>
              <StepButton label="Slower" Icon={Minus} disabled={rate <= RATE_MIN} onPress={() => setRate(rate - RATE_STEP)} />
              <Text style={{ minWidth: 44, textAlign: "center", fontVariant: ["tabular-nums"] }} accessibilityLabel={`Speed ${rate.toFixed(1)} times`}>
                {rate.toFixed(1)}×
              </Text>
              <StepButton label="Faster" Icon={Plus} disabled={rate >= RATE_MAX} onPress={() => setRate(rate + RATE_STEP)} />
            </View>
          }
        />
        <Row
          accessibilityLabel="Test voice"
          accessibilityHint="Speaks a short sample with this voice and speed"
          onPress={() => {
            haptics.tap();
            void testVoice(hosts[0]?.id);
          }}
          title="Test voice"
          detail="Play a short sample with this voice and speed."
          trailing={<Play size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
        />
        <Row
          accessibilityLabel="Speech log"
          onPress={() => router.push("/speech-log" as never) /* typed routes regenerate on the next dev start */}
          title="Speech log"
          detail="The last 20 speech and voice input events. Use it when a reply stays silent."
          chevron
        />
      </Group>
    </Section>
  );
}

/** "Feel": the Haptics switch. Off makes every haptic a no-op. Haptics stay on with Reduce Motion. */
function FeelSection() {
  const on = haptics.useFeelSettings((s) => s.haptics);
  const set = haptics.useFeelSettings((s) => s.set);
  return (
    <Section title="Feel">
      <Group>
        <Row
          title="Haptics"
          detail="Taps you feel for send, approve, peek and status changes."
          trailing={
            <GoldSwitch
              label="Haptics"
              value={on}
              onValueChange={(v) => {
                set({ haptics: v });
                if (v) haptics.tap();
              }}
            />
          }
        />
      </Group>
    </Section>
  );
}

/**
 * Settings: grouped bands with small uppercase headers. Each row has a title, one plain line under
 * it, and its control on the right (a gold switch, a segmented control, or a chevron).
 */
export default function SettingsScreen() {
  const router = useRouter();
  const hosts = useHosts((s) => s.hosts);
  return (
    <Screen flush>
      <Section title="Hosts">
        <Group>
          {hosts.length === 0 ? <Row title="No hosts yet" detail="Add one to get started." /> : null}
          {hosts.map((h) => (
            <HostRow key={h.id} host={h} />
          ))}
          <Row
            accessibilityLabel="Add host"
            onPress={() => router.push("/hosts/discover")}
            leading={<Plus size={icon.md} color={colors.accent} strokeWidth={icon.strokeWidth} />}
            title="Add host"
          />
          {hosts.length === 0 ? (
            <Row
              accessibilityLabel="Try the demo"
              accessibilityHint="Adds a demo computer with sample agents. It runs inside the app."
              onPress={() => {
                void startDemo().then(() => router.navigate("/"));
              }}
              leading={<Play size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
              title="Try the demo"
              detail="Sample agents that run inside the app. No computer needed."
            />
          ) : null}
        </Group>
      </Section>
      <Section title="Notifications">
        <Group>
          <PrefRow pref="finished" label="Finished" detail="An agent finished its turn." />
          <PrefRow pref="needs_you" label="Needs you" detail="An agent waits for your input." />
          <PrefRow
            pref="quiet_at_desk"
            label="Quiet at the computer"
            detail="No pushes while you use herdr on the computer, until 5 minutes after your last activity."
          />
          <PrefRow pref="replace" label="One notification per agent" detail="A new event replaces the old notification for the same agent." />
          <PrefRow pref="group" label="Group by computer" detail={IOS_ONLY ?? "Notifications from the same computer stay together."} />
          <PrefRow
            pref="quiet_finished"
            label="Deliver 'finished' quietly"
            detail={IOS_ONLY ?? "Finished notifications arrive without sound or banner."}
          />
        </Group>
      </Section>
      <VoiceSection />
      <VoiceInputSection />
      <FeelSection />
      <AppearanceSection />
      <Section title="About">
        <Group>
          <Row title="Version" detail={versionText()} />
        </Group>
      </Section>
    </Screen>
  );
}
