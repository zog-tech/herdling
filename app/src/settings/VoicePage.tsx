import * as Speech from "expo-speech";
import { Minus, Play, Plus, type LucideIcon } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { PHONE, PHONE_LABEL } from "@/device";
import { useHosts } from "@/hosts/store";
import { colors, hitTarget, icon, space } from "@/theme/tokens";
import { Button } from "@/ui/Button";
import { GoldSwitch } from "@/ui/GoldSwitch";
import { Group, Section } from "@/ui/Group";
import { PickerRow } from "@/ui/PickerRow";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";
import { Segmented } from "@/ui/Segmented";
import { Text } from "@/ui/Text";
import * as haptics from "@/ui/haptics";
import { useVoiceSettings } from "@/voice/settings";
import { testVoice } from "@/voice/useSpeakReplies";
import { VoiceInputSection } from "@/voice/VoiceInputSettings";
import { deviceVoices } from "@/voice/voiceList";

import { clampRate, RATE_MAX, RATE_MIN, RATE_STEP, SYSTEM_VOICE, voiceOptions, voiceValue } from "./voiceOptions";

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

/** A step button of the speed (−, +): an icon-only secondary button with a 44 pt target. */
function StepButton({ label, Icon, onPress, disabled }: { label: string; Icon: LucideIcon; onPress: () => void; disabled?: boolean }) {
  return (
    <Button
      label={label}
      iconOnly
      variant="secondary"
      Icon={Icon}
      disabled={disabled}
      onPress={() => {
        haptics.tap();
        onPress();
      }}
    />
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

/**
 * More, "Voice": spoken replies (on by default or not, what to read, the engine, the voice and the
 * speed, a test) and voice input (`VoiceInputSection`: engine, Parakeet models, cellular, Bluetooth).
 * The voice is a `PickerRow`: the list of device voices can be long, so the picker has a search.
 */
export function VoicePage() {
  const { ttsDefault, mode, engine, voice, rate, set } = useVoiceSettings();
  const voices = useDeviceVoices();
  const hosts = useHosts((s) => s.hosts);
  const setRate = (r: number) => set({ rate: clampRate(r) });
  return (
    <Screen flush>
      <Section title="Spoken replies">
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
                ? "A short summary: on-device (Apple Intelligence), then a computer command, then the full text."
                : "The full reply, as the agent wrote it."
            }
            below={<Segmented options={MODES} value={mode} onChange={(m) => set({ mode: m })} label="What to read" />}
          />
          <Row
            title="Voice engine"
            detail={engine === "host" ? `The computer's voice command (tts_command). Falls back to ${PHONE} voices.` : `The voices on this ${PHONE}.`}
            below={<Segmented options={ENGINES} value={engine} onChange={(e) => set({ engine: e })} label="Voice engine" />}
          />
          <PickerRow
            title="Voice"
            value={voiceValue(voices, voice)}
            accessibilityHint="Opens the list of voices"
            picker={{
              options: voiceOptions(voices),
              value: voice ?? SYSTEM_VOICE,
              search: true,
              searchPlaceholder: "Search voices",
              // The picker gives the pick haptic.
              onPick: (id) => set({ voice: id === SYSTEM_VOICE ? undefined : id }),
            }}
          />
          <Row
            title="Speed"
            trailing={
              <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
                <StepButton label="Slower" Icon={Minus} disabled={rate <= RATE_MIN} onPress={() => setRate(rate - RATE_STEP)} />
                <Text style={{ minWidth: hitTarget, textAlign: "center", fontVariant: ["tabular-nums"] }} accessibilityLabel={`Speed ${rate.toFixed(1)} times`}>
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
        </Group>
      </Section>
      <VoiceInputSection />
    </Screen>
  );
}
