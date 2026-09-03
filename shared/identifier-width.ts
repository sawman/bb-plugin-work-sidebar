/** A monospaced identifier column wide enough for every currently visible key. */
export function identifierColumnWidth(keys: Iterable<string>) {
  let widest = 1;
  for (const key of keys) widest = Math.max(widest, key.trim().length);
  return `${widest}ch`;
}
