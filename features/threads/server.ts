import { normalizeThreadGroups, type SidebarThreadGroup } from "./model";

export const THREAD_PREFERENCE_CHANNEL = "sidebar-order:changed";
export const THREAD_PREFERENCE_KEYS = {
  order: "sidebar-thread-order:v1",
  later: "sidebar-later-threads:v1",
  groups: "sidebar-thread-groups:v1",
} as const;

export function sanitizeThreadOrder(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap((item) => {
    const id = typeof item === "string" ? item.trim() : "";
    if (!/^thr_[A-Za-z0-9_-]+$/.test(id) || seen.has(id)) return [];
    seen.add(id);
    return [id];
  });
}

type Storage = {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
};
type ThreadPreferenceAdapter = {
  get: Storage["get"];
  set: Storage["set"];
  publish(channel: string, payload: unknown): void;
};
type ArchivedThreadRow = {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  environmentBranchName: string | null;
  pinnedAt: number | null;
  createdAt: number;
  updatedAt: number;
  archivedAt: number | null;
  deletedAt: number | null;
};
type ArchivedThreadAdapter = {
  list(options: {
    archived: true;
    includeHidden: true;
    limit: number;
  }): Promise<ArchivedThreadRow[]>;
  unarchive(input: { threadId: string }): Promise<unknown>;
};

export type ArchivedThreadService = {
  list(): Promise<ArchivedThreadProjection[]>;
  unarchive(threadId: string): Promise<unknown>;
};

export type ArchivedThreadProjection = {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  environmentBranchName: string | null;
  isPinned: boolean;
  isUnread: false;
  createdAt: number;
  updatedAt: number;
  archivedAt: number;
};

function projectArchivedThread(
  row: ArchivedThreadRow,
): ArchivedThreadProjection | null {
  if (row.archivedAt === null || row.deletedAt !== null) return null;
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    titleFallback: row.titleFallback,
    parentThreadId: row.parentThreadId,
    environmentBranchName: row.environmentBranchName,
    isPinned: row.pinnedAt !== null,
    isUnread: false,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    archivedAt: row.archivedAt,
  };
}

export function createArchivedThreadService(adapter: ArchivedThreadAdapter) {
  const service: ArchivedThreadService = {
    async list() {
      const rows = await adapter.list({
        archived: true,
        includeHidden: true,
        limit: 2_000,
      });
      return rows.flatMap((row) => {
        const projection = projectArchivedThread(row);
        return projection ? [projection] : [];
      });
    },
    unarchive(threadId: string) {
      return adapter.unarchive({ threadId });
    },
  };
  return service;
}

/** Server adapter for durable preferences only. Archive/delete stay BB native actions. */
export function createThreadPreferencesService(
  adapter: ThreadPreferenceAdapter,
) {
  return {
    async order() {
      return sanitizeThreadOrder(
        await adapter.get(THREAD_PREFERENCE_KEYS.order),
      );
    },
    async saveOrder(threadIds: unknown) {
      const value = sanitizeThreadOrder(threadIds);
      await adapter.set(THREAD_PREFERENCE_KEYS.order, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { threadIds: value });
      return value;
    },
    async later() {
      return sanitizeThreadOrder(
        await adapter.get(THREAD_PREFERENCE_KEYS.later),
      );
    },
    async saveLater(threadIds: unknown) {
      const value = sanitizeThreadOrder(threadIds);
      await adapter.set(THREAD_PREFERENCE_KEYS.later, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { threadIds: value });
      return value;
    },
    async groups(): Promise<SidebarThreadGroup[]> {
      return normalizeThreadGroups(
        await adapter.get(THREAD_PREFERENCE_KEYS.groups),
        await adapter.get(THREAD_PREFERENCE_KEYS.later),
      );
    },
    async saveGroups(groups: SidebarThreadGroup[]) {
      const value = normalizeThreadGroups({ groups });
      await adapter.set(THREAD_PREFERENCE_KEYS.groups, { groups: value });
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { groups: value });
      return value;
    },
  };
}
