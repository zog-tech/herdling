import { createContext, useContext, type ReactNode } from "react";
import { View } from "react-native";
import { createStore, useStore, type StoreApi } from "zustand";

import { colors, space } from "@/theme/tokens";

/**
 * The search marks of the thread rows. Each row reads only its own level from a small store, so a
 * new query or a jump re-renders only the rows whose mark changes, not the whole list.
 */
export type Marks = { ids: ReadonlySet<string>; current?: string };

export const newMarks = (): StoreApi<Marks> => createStore<Marks>(() => ({ ids: new Set<string>() }));

const NONE = newMarks();

export const SearchMarksContext = createContext<StoreApi<Marks> | null>(null);

/** 0: no match, 1: a match, 2: the current match. */
export function useMarkLevel(id: string): 0 | 1 | 2 {
  const store = useContext(SearchMarksContext) ?? NONE;
  return useStore(store, (s) => (s.current === id ? 2 : s.ids.has(id) ? 1 : 0));
}

/** The width of the mark bar at the left of a matching row. */
const BAR = 3;

/**
 * A bar at the left of a matching row: gold for the current match (the selected state), stone for
 * the others. The row content does not move.
 */
export function SearchMark({ id, children }: { id: string; children: ReactNode }) {
  const level = useMarkLevel(id);
  // Always the same View, so a mark never remounts the row (an open tool card stays open).
  return (
    <View
      style={
        level === 0
          ? undefined
          : {
              borderLeftWidth: BAR,
              borderLeftColor: level === 2 ? colors.accent : colors.textMuted,
              paddingLeft: space.sm,
              marginLeft: -(space.sm + BAR),
            }
      }
    >
      {children}
    </View>
  );
}
