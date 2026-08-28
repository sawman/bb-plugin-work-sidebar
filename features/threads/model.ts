export type ThreadSelectionModifiers = Readonly<{ toggle?: boolean; range?: boolean }>;

export type SidebarThreadGroup = Readonly<{ id: string; name: string; threadIds: string[] }>;

export const ACTIVE_THREAD_GROUP_ID = "active";

export type SidebarThreadGroupPosition = Readonly<{
  id: string;
  name: string;
  group: SidebarThreadGroup | null;
}>;

export type SidebarThreadGroupPreferences = Readonly<{
  groups: SidebarThreadGroup[];
  activeGroupPosition: number;
}>;

export function normalizeActiveGroupPosition(value: unknown, groupCount: number) {
  const position = typeof value === "number" && Number.isInteger(value) ? value : 0;
  return Math.max(0, Math.min(groupCount, position));
}

export function threadGroupPositions(
  groups: readonly SidebarThreadGroup[],
  activeGroupPosition: number,
): SidebarThreadGroupPosition[] {
  const positions: SidebarThreadGroupPosition[] = groups.map((group) => ({
    id: group.id,
    name: group.name,
    group,
  }));
  positions.splice(normalizeActiveGroupPosition(activeGroupPosition, groups.length), 0, {
    id: ACTIVE_THREAD_GROUP_ID,
    name: "Active",
    group: null,
  });
  return positions;
}

export function moveThreadGroup(
  groups: readonly SidebarThreadGroup[],
  activeGroupPosition: number,
  groupId: string,
  direction: -1 | 1,
): SidebarThreadGroupPreferences | null {
  const positions = threadGroupPositions(groups, activeGroupPosition);
  const source = positions.findIndex((position) => position.id === groupId);
  const destination = source + direction;
  if (source < 0 || destination < 0 || destination >= positions.length)
    return null;
  [positions[source], positions[destination]] = [
    positions[destination]!,
    positions[source]!,
  ];
  const activePosition = positions.findIndex(
    (position) => position.id === ACTIVE_THREAD_GROUP_ID,
  );
  return {
    groups: positions.flatMap((position) =>
      position.group ? [position.group] : [],
    ),
    activeGroupPosition: activePosition,
  };
}

export function reorderThreadGroup(
  groups: readonly SidebarThreadGroup[],
  activeGroupPosition: number,
  sourceId: string,
  targetId: string,
): SidebarThreadGroupPreferences | null {
  const positions = threadGroupPositions(groups, activeGroupPosition);
  const source = positions.findIndex((position) => position.id === sourceId);
  const target = positions.findIndex((position) => position.id === targetId);
  if (source < 0 || target < 0 || source === target) return null;
  const [moved] = positions.splice(source, 1);
  if (!moved) return null;
  positions.splice(target, 0, moved);
  return {
    groups: positions.flatMap((position) =>
      position.group ? [position.group] : [],
    ),
    activeGroupPosition: positions.findIndex(
      (position) => position.id === ACTIVE_THREAD_GROUP_ID,
    ),
  };
}

type CountableThread = Readonly<{
  id: string;
  parentThreadId: string | null;
}>;

export function threadCountPresentation(threads: readonly CountableThread[]) {
  const ids = new Set(threads.map((thread) => thread.id));
  const rootCount = threads.filter(
    (thread) =>
      !thread.parentThreadId || !ids.has(thread.parentThreadId),
  ).length;
  const subthreadCount = threads.length - rootCount;
  const threadLabel = `${rootCount} thread${rootCount === 1 ? "" : "s"}`;
  const subthreadLabel = `${subthreadCount} subthread${subthreadCount === 1 ? "" : "s"}`;
  return {
    threads: rootCount,
    subthreads: subthreadCount,
    label: `${threadLabel} · ${subthreadLabel}`,
  };
}

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
export type SidebarView = "work" | "queue" | "prs";

export function sidebarViewLabel(id: SidebarView): string {
  switch (id) {
    case "queue": return "Tasks";
    case "prs": return "PRs";
    default: return "Threads";
  }
}

/** Compact elapsed time from BB's exact archival timestamp for narrow rows. */
export function archiveDurationLabel(
  archivedAt: number,
  now: number,
): string | null {
  if (!Number.isFinite(archivedAt) || archivedAt <= 0 || now < archivedAt)
    return null;
  const minutes = Math.floor((now - archivedAt) / 60_000);
  if (minutes < 1) return "<1m";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
