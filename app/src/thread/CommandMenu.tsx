import type { CommandInfo } from "@herdling/protocol";

import { sheet } from "@/theme/tokens";
import { MenuRow } from "@/ui/MenuSheet";

import { InlineMenu } from "./InlineMenu";

/** Rows visible before the list scrolls. */
export const MENU_ROWS = 4.5;

/** The text of a command: `/name` (`$name` for a Codex skill, `@name` for an OpenCode skill). */
export const commandText = (c: CommandInfo) => `${c.trigger ?? "/"}${c.name}`;

/** One command in the menu row look: the command and its description as the detail line. */
export function CommandRow({ c, onPick }: { c: CommandInfo; onPick: (c: CommandInfo) => void }) {
  return <MenuRow item={{ label: commandText(c), detail: c.description || undefined }} onPress={() => onPick(c)} />;
}

/** The list above the composer while the user types `/name`. Taps do not close the keyboard. */
export function CommandMenu({ commands, onPick }: { commands: CommandInfo[]; onPick: (c: CommandInfo) => void }) {
  return (
    <InlineMenu label="Commands" maxHeight={Math.round(sheet.rowHeight * MENU_ROWS)}>
      {commands.map((c) => (
        <CommandRow key={c.name} c={c} onPick={onPick} />
      ))}
    </InlineMenu>
  );
}
