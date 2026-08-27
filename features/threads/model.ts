export type ThreadSelectionModifiers = Readonly<{ toggle?: boolean; range?: boolean }>;

export type ThreadSelectionResult = Readonly<{
  selectedIds: Set<string>;
  anchorId: string | null;
  handled: boolean;
}>;

/**
 * Selection is presentation state. The host still owns what each thread is,
 * and ordinary clicks deliberately return `handled: false` for native open.
 */
export function selectThreadIds(
  selectedIds: ReadonlySet<string>,
  anchorId: string | null,
  visibleIds: readonly string[],
  targetId: string,
  modifiers: ThreadSelectionModifiers,
): ThreadSelectionResult {
  if (modifiers.range && anchorId) {
    const first = visibleIds.indexOf(anchorId);
    const last = visibleIds.indexOf(targetId);
    if (first >= 0 && last >= 0) {
      return {
        selectedIds: new Set(visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1)),
        anchorId,
        handled: true,
      };
    }
  }
  if (modifiers.toggle) {
    const next = new Set(selectedIds);
    if (next.has(targetId)) next.delete(targetId); else next.add(targetId);
    return { selectedIds: next, anchorId: targetId, handled: true };
  }
  return { selectedIds: new Set([targetId]), anchorId: targetId, handled: Boolean(modifiers.range) };
}
