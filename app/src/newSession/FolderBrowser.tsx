import type { FsDirs } from "@herdling/protocol";
import { ArrowUp, ChevronRight, Folder, FolderGit2, FolderX, House, TriangleAlert } from "lucide-react-native";
import type { LucideIcon } from "lucide-react-native";
import { useRef } from "react";
import { Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from "react-native";

import { colors, denseScale, hitTarget, icon, radius, space, state } from "@/theme/tokens";
import { DelayedSpinner } from "@/ui/Delayed";
import { StateNotice } from "@/ui/StateNotice";
import { Text } from "@/ui/Text";

import { breadcrumbs, joinPath, parentOf } from "./paths";

/** Rows drawn at most. A larger folder says how many more there are: the path field filters them. */
export const MAX_ROWS = 300;

function IconButton({ Icon, label, onPress, disabled }: { Icon: LucideIcon; label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => ({
        width: hitTarget,
        height: hitTarget,
        borderRadius: radius.md,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: pressed ? colors.raisedHigh : colors.raised,
        opacity: disabled ? state.disabledOpacity : 1,
      })}
    >
      <Icon size={icon.md} color={colors.text} strokeWidth={icon.strokeWidth} />
    </Pressable>
  );
}

/** Up, Home and the breadcrumb path: tap a segment to go up to it. The row scrolls to its end. */
function NavBar({ path, home, onOpen, disabled }: { path: string; home: string; onOpen: (p: string) => void; disabled?: boolean }) {
  const crumbs = breadcrumbs(path, home);
  const scroll = useRef<ScrollViewInstance>(null);
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}>
      <IconButton Icon={ArrowUp} label="Up one folder" disabled={disabled || path === "/"} onPress={() => onOpen(parentOf(path))} />
      <IconButton Icon={House} label="Home folder" disabled={disabled || path === home} onPress={() => onOpen(home)} />
      <ScrollView
        ref={scroll}
        horizontal
        showsHorizontalScrollIndicator={false}
        onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        style={{ flex: 1 }}
        contentContainerStyle={{ alignItems: "center" }}
        accessibilityLabel="Folder path"
      >
        {crumbs.map((c, i) => {
          const last = i === crumbs.length - 1;
          return (
            <View key={c.path} style={{ flexDirection: "row", alignItems: "center" }}>
              {i > 0 && c.label !== "/" ? <ChevronRight size={icon.sm} color={colors.textMuted} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={last ? `${c.label}, current folder` : `Go up to ${c.label}`}
                accessibilityState={{ selected: last, disabled: !!disabled }}
                disabled={disabled || last}
                onPress={() => onOpen(c.path)}
                hitSlop={{ top: space.sm, bottom: space.sm }}
                style={({ pressed }) => ({
                  minHeight: hitTarget,
                  justifyContent: "center",
                  paddingHorizontal: space.sm,
                  borderRadius: radius.sm,
                  backgroundColor: pressed ? colors.raised : "transparent",
                })}
              >
                <Text mono bold={last} muted={!last} maxFontSizeMultiplier={denseScale.row} numberOfLines={1}>
                  {c.label}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

/**
 * The folder browser of New session: the nav bar and the sub-folders of the current folder.
 * A tap on a row opens it. Git repos have the git folder icon (herdlingd 0.1.1 sends `git_dirs`).
 */
export function FolderBrowser({
  listing,
  home,
  loading,
  error,
  onOpen,
  onRetry,
  disabled,
}: {
  listing: FsDirs | undefined;
  home: string | undefined;
  loading: boolean;
  error?: string;
  onOpen: (path: string) => void;
  onRetry: () => void;
  disabled?: boolean;
}) {
  if (!listing || !home) {
    return error ? (
      <StateNotice Icon={TriangleAlert} color={colors.danger} message={error} action="Retry" onAction={onRetry} />
    ) : (
      <View style={{ minHeight: hitTarget * 2, alignItems: "center", justifyContent: "center" }}>
        <DelayedSpinner color={colors.textMuted} />
      </View>
    );
  }
  const git = new Set(listing.git_dirs ?? []);
  const rows = listing.dirs.slice(0, MAX_ROWS);
  const more = listing.dirs.length - rows.length;
  return (
    <View style={{ gap: space.sm }}>
      <NavBar path={listing.path} home={home} onOpen={onOpen} disabled={disabled} />
      {error ? <StateNotice Icon={TriangleAlert} color={colors.danger} message={error} action="Retry" onAction={onRetry} /> : null}
      <View
        style={{ borderRadius: radius.lg, backgroundColor: colors.card, overflow: "hidden", opacity: loading ? state.offlineOpacity : 1 }}
        accessibilityState={{ busy: loading }}
      >
        {rows.length === 0 ? (
          <View style={{ paddingHorizontal: space.lg }}>
            <StateNotice Icon={FolderX} message="No sub-folders here. You can start in this folder." />
          </View>
        ) : (
          rows.map((d, i) => {
            const isGit = git.has(d);
            const Icon = isGit ? FolderGit2 : Folder;
            return (
              <Pressable
                key={d}
                accessibilityRole="button"
                accessibilityLabel={`Open ${d}${isGit ? ", git repository" : ""}`}
                disabled={disabled}
                onPress={() => onOpen(joinPath(listing.path, d))}
                style={({ pressed }) => ({
                  minHeight: hitTarget,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.md,
                  paddingHorizontal: space.lg,
                  paddingVertical: space.sm,
                  borderTopWidth: i > 0 ? StyleSheet.hairlineWidth : 0,
                  borderColor: colors.divider,
                  backgroundColor: pressed ? colors.raised : "transparent",
                })}
              >
                <Icon size={icon.md} color={isGit ? colors.text : colors.textMuted} strokeWidth={icon.strokeWidth} />
                <Text mono numberOfLines={1} style={{ flex: 1 }}>
                  {d}
                </Text>
                <ChevronRight size={icon.md} color={colors.textMuted} strokeWidth={icon.strokeWidth} />
              </Pressable>
            );
          })
        )}
        {more > 0 ? (
          <Text variant="caption" muted style={{ padding: space.lg }}>
            {`${more} more folders. Type in the path field to find one.`}
          </Text>
        ) : null}
      </View>
    </View>
  );
}
