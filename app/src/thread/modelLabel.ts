/**
 * A short name for the model an agent uses (`ThreadPage.model`): "Opus 5.5" for
 * `claude-opus-5-5`, "Sonnet 3.5" for `claude-3-5-sonnet-20241022`, "Opus 5.5 · 1M" for a 1M
 * context id (`[1m]`). A name from a `/model` switch ("Opus 5.5") stays as it is. Another agent's
 * id (`gpt-5.5`) shows as it is, without a provider prefix, cut to `MAX_CHARS`.
 */

const FAMILIES = ["opus", "sonnet", "haiku", "fable"] as const;
/** Longest label, in chars. A longer one ends with "…". */
export const MAX_CHARS = 24;

const title = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "5.5" from the number groups of an id. */
function version(groups: string[]): string {
  return groups.slice(0, 2).join(".");
}

/** The family and version of a Claude id, or undefined when `id` is not one. */
function claudeName(id: string): string | undefined {
  const parts = id.toLowerCase().split("-");
  if (parts[0] !== "claude") return undefined;
  const rest = parts.slice(1);
  const at = rest.findIndex((p) => (FAMILIES as readonly string[]).includes(p));
  if (at < 0) return undefined;
  const family = title(rest[at]);
  // New ids: claude-opus-5-5. Older ids: claude-3-5-sonnet-20241022.
  // A date group (8 digits) is not part of the version.
  const nums = (ps: string[]) => ps.filter((p) => /^\d{1,7}$/.test(p));
  const after = nums(rest.slice(at + 1));
  const before = nums(rest.slice(0, at));
  const v = version(after.length > 0 ? after : before);
  return v ? `${family} ${v}` : family;
}

function cut(s: string): string {
  return s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1).trimEnd()}…` : s;
}

/** The short label of a model value. Undefined for an empty or missing value. */
export function modelLabel(model: string | null | undefined): string | undefined {
  let s = model?.trim();
  if (!s) return undefined;
  let suffix = "";
  const big = /\[1m\]$/i;
  if (big.test(s)) {
    s = s.replace(big, "").trim();
    suffix = " · 1M";
  }
  if (!s) return undefined;
  const claude = claudeName(s);
  if (claude) return claude + suffix;
  // An alias, as in a subagent call or `/model opus`.
  if ((FAMILIES as readonly string[]).includes(s.toLowerCase())) return title(s.toLowerCase()) + suffix;
  // "openai/gpt-5.5" → "gpt-5.5".
  const bare = s.includes("/") && !s.includes(" ") ? s.slice(s.lastIndexOf("/") + 1) || s : s;
  return cut(bare) + suffix;
}
