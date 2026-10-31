/** A voice as expo-speech lists it. */
export type ListedVoice = { identifier: string; name: string; language: string; quality: string };

const REGION: Record<string, string> = {
  US: "US",
  GB: "UK",
  AU: "Australia",
  IE: "Ireland",
  IN: "India",
  ZA: "South Africa",
  CA: "Canada",
  NZ: "New Zealand",
};

/** The accent part of a language tag ("en-GB" → "UK"). Unknown regions show their code. */
export function accentOf(language: string): string | undefined {
  const region = language.split(/[-_]/)[1]?.toUpperCase();
  if (!region) return undefined;
  return REGION[region] ?? region;
}

/**
 * Voices for one device locale: only its language, voices of its region first, then enhanced
 * first, then by name and accent. iOS has some voices once per accent ("Flo" in US and UK
 * English), so each row also shows its accent.
 */
export function deviceVoices<V extends ListedVoice>(all: V[], locale: string): V[] {
  const [lang, region] = locale.split(/[-_]/).map((p) => p.toLowerCase());
  const mine = all.filter((v) => v.language.toLowerCase().startsWith(lang));
  const regionRank = (v: V) => (region && v.language.toLowerCase().split(/[-_]/)[1] === region ? 0 : 1);
  const qualityRank = (v: V) => (v.quality === "Enhanced" ? 0 : 1);
  return [...mine].sort(
    (a, b) =>
      regionRank(a) - regionRank(b) ||
      qualityRank(a) - qualityRank(b) ||
      a.name.localeCompare(b.name) ||
      a.language.localeCompare(b.language),
  );
}

/** "Flo · UK", or the name alone when the tag has no region. */
export function voiceLabel(v: Pick<ListedVoice, "name" | "language">): string {
  const accent = accentOf(v.language);
  return accent ? `${v.name} · ${accent}` : v.name;
}
