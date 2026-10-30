/**
 * Slots counted from the end, so "9s" → "10s" rolls only the digit that changed and the "s" stays.
 * Each slot is keyed by its character: a changed character mounts a new view and rolls.
 */
export function rollSlots(text: string): { key: string; ch: string }[] {
  const chars = Array.from(text);
  return chars.map((ch, i) => ({ key: `${chars.length - 1 - i}:${ch}`, ch }));
}
