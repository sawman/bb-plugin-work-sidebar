export type ThreadSelectionModifiers = Readonly<{ toggle?: boolean; range?: boolean }>;

export type SidebarThreadGroup = Readonly<{ id: string; name: string; threadIds: string[] }>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function sanitizeThreadIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const id = typeof item === "string" ? item.trim() : "";
    if (!/^thr_[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

/** Browser-safe recovered preference normalization; it deliberately has no server dependency. */
export function normalizeThreadGroups(value: unknown, legacyLater: unknown = []): SidebarThreadGroup[] {
  const rawGroups = isRecord(value) && Array.isArray(value.groups) ? value.groups : null;
  const candidates = rawGroups ?? [{ id: "group_later", name: "Later", threadIds: sanitizeThreadIds(legacyLater) }];
  const usedIds = new Set<string>();
  const assignedThreads = new Set<string>();
  return candidates.flatMap((candidate): SidebarThreadGroup[] => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !/^group_[a-z0-9_-]{1,48}$/.test(candidate.id) || usedIds.has(candidate.id)) return [];
    const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 40) : "";
    if (!name) return [];
    usedIds.add(candidate.id);
    const threadIds = sanitizeThreadIds(candidate.threadIds).filter((threadId) => !assignedThreads.has(threadId));
    threadIds.forEach((threadId) => assignedThreads.add(threadId));
    return [{ id: candidate.id, name, threadIds }];
  });
}

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
