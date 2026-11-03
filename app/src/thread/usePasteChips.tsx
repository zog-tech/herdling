/**
 * The "Pasted text #n" chips of one prompt box: the session composer and the first prompt of
 * New Session share them. The hook keeps the chips, checks each change of the box for a long
 * paste (see `pastedText.ts`), and gives the chip tiles and the viewer sheet to render.
 * The screen uploads the chips itself (`uploadPhotos`) and then calls `sent`.
 */
import { useRef, useState, type ReactNode } from "react";
import type { TextInputSelectionChangeEvent } from "react-native";

import { openPasteMenu, PasteChip, PasteViewer } from "./PasteChip";
import { detectPaste, insertAt, makePaste, type PastedText } from "./pastedText";

export type PasteChips = {
  /** The chips in the draft, in paste order. */
  pastes: PastedText[];
  /**
   * Checks one change of the box (`prev` → `next`). A long paste becomes a chip. Returns the text
   * for the box: `next` without the pasted block.
   */
  change: (prev: string, next: string) => string;
  /** Removes the chips in `list` after a send. A new draft numbers its chips from 1 again. */
  sent: (list: readonly PastedText[]) => void;
  /** Keeps the cursor of the box, for "Insert as text". Pass it to `onSelectionChange`. */
  onSelectionChange: (e: TextInputSelectionChangeEvent) => void;
  /** The chip tiles, for a `PhotoStrip` or a row. */
  chips: ReactNode[];
  /** The sheet that shows the full text of a chip. Render it once. */
  viewer: ReactNode;
};

export function usePasteChips({
  enabled,
  disabled,
  putText,
  focus,
}: {
  /** False: no new chips (a host without `files.put`, a shell command). The chips already made stay. */
  enabled: boolean;
  /** True while a send runs: the chip buttons do nothing. */
  disabled?: boolean;
  /** Sets the box text from code. "Insert as text" puts the paste back with it. */
  putText: (next: (cur: string) => string) => void;
  /** Gives the box the focus after "Insert as text". */
  focus?: () => void;
}): PasteChips {
  const [pastes, setPastes] = useState<PastedText[]>([]);
  /** The number of the last chip in this draft. */
  const count = useRef(0);
  const pastesNow = useRef(pastes);
  pastesNow.current = pastes;
  /** The paste in the viewer sheet. It stays set while the sheet closes. */
  const [viewing, setViewing] = useState<PastedText>();
  const [viewerOpen, setViewerOpen] = useState(false);
  /** The cursor in the box, for "Insert as text". */
  const cursor = useRef<number | undefined>(undefined);

  const remove = (p: PastedText) => setPastes((cur) => cur.filter((x) => x !== p));
  /** Puts a paste back in the box at the cursor (or at the end) and removes its chip. */
  const insert = (p: PastedText) => {
    putText((cur) => insertAt(cur, p.text, cursor.current));
    remove(p);
    focus?.();
  };

  const change = (prev: string, next: string): string => {
    // No paste event in React Native: a change that inserts a long block is a paste.
    const cut = enabled ? detectPaste(prev, next) : undefined;
    if (!cut) return next;
    const p = makePaste(++count.current, cut.pasted);
    setPastes((cur) => [...cur, p]);
    cursor.current = cut.at;
    return cut.text;
  };

  const sent = (list: readonly PastedText[]) => {
    if (list.length === 0) return;
    setPastes((cur) => cur.filter((p) => !list.includes(p)));
    // A new draft numbers its chips from 1 again, unless a paste came in during the upload.
    if (pastesNow.current.length === list.length) count.current = 0;
  };

  const chips = pastes.map((p) => (
    <PasteChip
      key={p.n}
      paste={p}
      disabled={disabled}
      onPress={() =>
        openPasteMenu(
          p,
          () => {
            setViewing(p);
            setViewerOpen(true);
          },
          () => insert(p),
        )
      }
      onRemove={() => remove(p)}
    />
  ));

  return {
    pastes,
    change,
    sent,
    onSelectionChange: (e) => {
      cursor.current = e.nativeEvent.selection.start;
    },
    chips,
    viewer: <PasteViewer paste={viewing} visible={viewerOpen} onClose={() => setViewerOpen(false)} />,
  };
}
