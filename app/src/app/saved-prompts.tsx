import { Plus, RotateCcw } from "lucide-react-native";
import { Alert } from "react-native";

import { colors, icon } from "@/theme/tokens";
import {
  changePrompt,
  deletePrompt,
  PROMPT_ACTION_LABEL,
  promptActions,
  promptChipLabel,
  reorderPrompt,
  restoreDefaultPrompts,
  SAVED_PROMPT_CAP,
  saveNewPrompt,
  useSavedPrompts,
  type PromptAction,
} from "@/thread/savedPrompts";
import { Group, Section } from "@/ui/Group";
import * as haptics from "@/ui/haptics";
import { promptText, showActionSheet } from "@/ui/nativeSheet";
import { Row } from "@/ui/Row";
import { Screen } from "@/ui/Screen";

/** Asks for the text of a prompt: a new one, or a change to the one at `index`. */
function askText(index?: number, value = "") {
  promptText(
    index === undefined ? "New saved prompt" : "Edit saved prompt",
    "The text goes in the prompt box when you tap its chip.",
    [
      { text: "Cancel", style: "cancel" },
      {
        text: "Save",
        onPress: (t) => {
          if (t === undefined) return;
          if (index === undefined) saveNewPrompt(t);
          else changePrompt(index, t);
          haptics.commit();
        },
      },
    ],
    value,
  );
}

function run(action: PromptAction, index: number, text: string) {
  if (action === "edit") askText(index, text);
  else if (action === "up") reorderPrompt(index, index - 1);
  else if (action === "down") reorderPrompt(index, index + 1);
  else deletePrompt(index);
}

function openMenu(index: number, count: number, text: string) {
  const actions = promptActions(index, count);
  showActionSheet(
    {
      title: promptChipLabel(text),
      options: [...actions.map((a) => PROMPT_ACTION_LABEL[a]), "Cancel"],
      cancelButtonIndex: actions.length,
      destructiveButtonIndex: actions.indexOf("delete"),
    },
    (i) => {
      const a = actions[i];
      if (a) run(a, index, text);
    },
  );
}

/**
 * Settings, "Saved prompts": the quick replies that the composer shows as chips. A tap on a prompt
 * opens its menu (edit, move up, move down, delete). The list stays on this phone.
 */
export default function SavedPromptsScreen() {
  const prompts = useSavedPrompts((s) => s.prompts);
  const full = prompts.length >= SAVED_PROMPT_CAP;
  return (
    <Screen flush>
      <Section
        title="Saved prompts"
        footer="The prompts show as chips above the empty prompt box. A tap puts the text in the box. A long press sends it. They stay on this phone."
      >
        <Group>
          {prompts.length === 0 ? <Row title="No saved prompts" detail="Add one to see it above the prompt box." /> : null}
          {prompts.map((text, i) => {
            const actions = promptActions(i, prompts.length);
            return (
              <Row
                key={text}
                title={promptChipLabel(text)}
                accessibilityLabel={`Saved prompt ${i + 1} of ${prompts.length}: ${promptChipLabel(text)}`}
                accessibilityHint="Opens the actions for this prompt"
                accessibilityActions={actions.map((a) => ({ name: a, label: PROMPT_ACTION_LABEL[a] }))}
                onAccessibilityAction={(e) => {
                  const a = actions.find((x) => x === e.nativeEvent.actionName);
                  if (a) run(a, i, text);
                }}
                onPress={() => {
                  haptics.tap();
                  openMenu(i, prompts.length, text);
                }}
              />
            );
          })}
        </Group>
      </Section>
      <Section>
        <Group>
          <Row
            accessibilityLabel="Add a prompt"
            onPress={full ? undefined : () => askText()}
            leading={<Plus size={icon.md} color={full ? colors.textMuted : colors.accent} strokeWidth={icon.strokeWidth} />}
            title="Add a prompt"
            detail={full ? `You can save up to ${SAVED_PROMPT_CAP} prompts.` : undefined}
          />
          <Row
            accessibilityLabel="Restore the defaults"
            onPress={() => {
              haptics.warn();
              Alert.alert("Restore the defaults?", "This replaces your saved prompts with the default list.", [
                { text: "Cancel", style: "cancel" },
                { text: "Restore", style: "destructive", onPress: restoreDefaultPrompts },
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
