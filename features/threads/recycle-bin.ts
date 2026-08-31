export type RecycleBinEntry = Readonly<{
  threadId: string;
  originGroupId: string | null;
  binnedAt: number;
}>;

const THREAD_ID = /^thr_[A-Za-z0-9_-]+$/;

/** Durable plugin-only filing state. It never represents host archive state. */
export function normalizeRecycleBin(value: unknown): RecycleBinEntry[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const threadId = Reflect.get(candidate, "threadId");
    const originGroupId = Reflect.get(candidate, "originGroupId");
    const binnedAt = Reflect.get(candidate, "binnedAt");
    if (
      typeof threadId !== "string" ||
      !THREAD_ID.test(threadId) ||
      seen.has(threadId) ||
      (originGroupId !== null &&
        (typeof originGroupId !== "string" || !originGroupId.startsWith("group_"))) ||
      typeof binnedAt !== "number" ||
      !Number.isFinite(binnedAt) ||
      binnedAt <= 0
    )
      return [];
    seen.add(threadId);
    return [{ threadId, originGroupId, binnedAt }];
  });
}

export function binThread(
  entries: readonly RecycleBinEntry[],
  threadId: string,
  originGroupId: string | null,
  now = Date.now(),
) {
  return [
    ...entries.filter((entry) => entry.threadId !== threadId),
    { threadId, originGroupId, binnedAt: now },
  ] satisfies RecycleBinEntry[];
}

export function restoreThread(
  entries: readonly RecycleBinEntry[],
  threadId: string,
  existingGroupIds: ReadonlySet<string>,
) {
  const entry = entries.find((candidate) => candidate.threadId === threadId);
  return {
    destination:
      entry?.originGroupId && existingGroupIds.has(entry.originGroupId)
        ? entry.originGroupId
        : null,
    entries: entries.filter((candidate) => candidate.threadId !== threadId),
  };
}

export function filterBinnedThreadIds(
  threadIds: readonly string[],
  entries: readonly RecycleBinEntry[],
) {
  const binned = new Set(entries.map((entry) => entry.threadId));
  return threadIds.filter((threadId) => !binned.has(threadId));
}
