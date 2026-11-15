import { Keyboard as KeyboardIcon, RotateCcw, Type } from "lucide-react-native";
import { Alert } from "react-native";

import {
  changeKey,
  CUSTOM_KEY_CAP,
  deleteKey,
  KEY_CHOICES,
  keyA11y,
  keyLabel,
  reorderKey,
  restoreDefaultKeys,
  saveNewKey,
  useCustomKeys,
  type CustomKey,
} from "@/terminal/customKeys";
import { colors, icon } from "@/theme/tokens";
import { Group, Section } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { promptText, showActionSheet } from "@/ui/nativeSheet";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

/** Asks for the text of a macro, then whether it presses Enter. `index`: a change of that item. */
function askMacro(index?: number, value = "") {
  promptText(
    index === undefined ? "New text key" : "Edit text key",
    "A tap types this text into the terminal.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Next",
        onPress: (text) => {
          if (text === undefined) return;
          // After the prompt closes, so the two sheets do not overlap.
          setTimeout(
            () =>
              showActionSheet({ title: "Press Enter after the text?", options: ["Type and press Enter", "Type only", "Cancel"], cancelButtonIndex: 2 }, (i) => {
                if (i > 1) return;
                const k: CustomKey = { kind: "text", text, enter: i === 0 };
                if (index === undefined) saveNewKey(k);
                else changeKey(index, k);
                haptics.commit();
              }),
            0,
          );
        },
      },
    ],
    value,
  );
}

/** Picks a named key. `index`: a change of that item. */
function askKey(index?: number) {
  showActionSheet(
    { title: "Key", options: [...KEY_CHOICES.map((c) => c.label), "Cancel"], cancelButtonIndex: KEY_CHOICES.length },
    (i) => {
      const c = KEY_CHOICES[i];
      if (!c) return;
      const k: CustomKey = { kind: "key", key: c.key };
      if (index === undefined) saveNewKey(k);
      else changeKey(index, k);
      haptics.commit();
    },
  );
}

function openMenu(index: number, count: number, k: CustomKey) {
  const items: { label: string; destructive?: boolean; run: () => void }[] = [
    { label: "Edit", run: () => (k.kind === "text" ? askMacro(index, k.text) : askKey(index)) },
    ...(index > 0 ? [{ label: "Move left", run: () => reorderKey(index, index - 1) }] : []),
    ...(index < count - 1 ? [{ label: "Move right", run: () => reorderKey(index, index + 1) }] : []),
    { label: "Delete", destructive: true, run: () => deleteKey(index) },
  ];
  showActionSheet(
    {
      title: keyLabel(k),
      options: [...items.map((i) => i.label), "Cancel"],
      cancelButtonIndex: items.length,
      destructiveButtonIndex: items.length - 1,
    },
    (i) => items[i]?.run(),
  );
}

/**
 * Settings, "Key bar": the custom keys at the end of the terminal key bar. A text key types its
 * text (and Enter, when set); a named key presses that key. The list stays on this phone.
 */
export default function KeyBarScreen() {
  const keys = useCustomKeys((s) => s.keys);
  const full = keys.length >= CUSTOM_KEY_CAP;
  return (
    <Screen flush>
      <Section
        title="Custom keys"
        footer="These keys come after the arrows on the terminal key bar. Swipe the bar to see them. They stay on this phone."
      >
        <Group>
          {keys.length === 0 ? <Row title="No custom keys" detail="Add a text key such as /new or yes." /> : null}
          {keys.map((k, i) => (
            <Row
              key={`${i}:${keyLabel(k)}`}
              title={keyLabel(k)}
              detail={k.kind === "text" ? (k.enter ? "Types the text, then presses Enter." : "Types the text.") : "Presses the key."}
              accessibilityLabel={`Custom key ${i + 1} of ${keys.length}: ${keyA11y(k)}`}
              accessibilityHint="Opens the actions for this key"
              onPress={() => {
                haptics.tap();
                openMenu(i, keys.length, k);
              }}
            />
          ))}
        </Group>
      </Section>
      <Section>
        <Group>
          <Row
            accessibilityLabel="Add a text key"
            onPress={full ? undefined : () => askMacro()}
            leading={<Type size={icon.md} color={full ? colors.textMuted : colors.accent} strokeWidth={icon.strokeWidth} />}
            title="Add a text key"
            detail={full ? `You can keep up to ${CUSTOM_KEY_CAP} custom keys.` : undefined}
          />
          <Row
            accessibilityLabel="Add a named key"
            onPress={full ? undefined : () => askKey()}
            leading={<KeyboardIcon size={icon.md} color={full ? colors.textMuted : colors.accent} strokeWidth={icon.strokeWidth} />}
            title="Add a named key"
            detail="Home, End, Page Up, F1 to F12 and more."
          />
          <Row
            accessibilityLabel="Restore the defaults"
            onPress={() => {
              haptics.warn();
              Alert.alert("Restore the defaults?", "This replaces your custom keys with the default list.", [
                { text: "Cancel", style: "cancel" },
                { text: "Restore", style: "destructive", onPress: restoreDefaultKeys },
              ]);
            }}
            leading={<RotateCcw size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />}
            title="Restore the defaults"
          />
        </Group>
      </Section>
    </Screen>
  );
}
