import { expiredRecycleBinEntries, type RecycleBinEntry } from "./recycle-bin.js";

type RecycleBinPreferences = {
  recycleBin(): Promise<RecycleBinEntry[]>;
  removeBinnedThread(threadId: string): Promise<RecycleBinEntry[]>;
};

/**
 * Deliberately invoked by an external automation; the sidebar never schedules
 * destructive archival on its own. Each accepted host archive is persisted
 * before the next one runs, so a later failure leaves remaining entries safe.
 */
export function createRecycleBinExpiryHandler(
  preferences: RecycleBinPreferences,
  archive: (threadId: string) => Promise<unknown>,
) {
  return async ({ retentionDays }: { retentionDays: number }) => {
    const archivedThreadIds: string[] = [];
    for (const entry of expiredRecycleBinEntries(
      await preferences.recycleBin(),
      retentionDays,
    )) {
      await archive(entry.threadId);
      await preferences.removeBinnedThread(entry.threadId);
      archivedThreadIds.push(entry.threadId);
    }
    return { archivedThreadIds, entries: await preferences.recycleBin() };
  };
}
