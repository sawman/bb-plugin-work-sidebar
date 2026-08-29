import {
  normalizeActiveGroupPosition,
  normalizeThreadGroups,
  type SidebarThreadGroup,
  type SidebarThreadGroupPreferences,
} from "./model";
import {
  normalizeSidebarRowHeight,
  validateSidebarRowHeight,
  normalizeTextScale,
  validateTextScale,
} from "./sidebar-appearance.js";

export const THREAD_PREFERENCE_CHANNEL = "sidebar-order:changed";
export const THREAD_PREFERENCE_KEYS = {
  order: "sidebar-thread-order:v1",
  later: "sidebar-later-threads:v1",
  groups: "sidebar-thread-groups:v1",
  appearance: "sidebar-appearance:v1",
  textScale: "sidebar-text-scale:v1",
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
  providerId: string;
  environmentBranchName: string | null;
  environmentName: string | null;
  environmentWorkspaceDisplayKind:
    | "managed-worktree"
    | "unmanaged-worktree"
    | "other";
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
  providerId: string;
  environmentBranchName: string | null;
  environmentName: string | null;
  environmentWorkspaceDisplayKind:
    | "managed-worktree"
    | "unmanaged-worktree"
    | "other";
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
    providerId: row.providerId,
    environmentBranchName: row.environmentBranchName,
    environmentName: row.environmentName,
    environmentWorkspaceDisplayKind: row.environmentWorkspaceDisplayKind,
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
  async function appearance() {
    return {
      rowHeight: normalizeSidebarRowHeight(
        await adapter.get(THREAD_PREFERENCE_KEYS.appearance),
      ),
      textScale: normalizeTextScale(
        await adapter.get(THREAD_PREFERENCE_KEYS.textScale),
      ),
    };
  }

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
    async groups(): Promise<SidebarThreadGroupPreferences> {
      const stored = await adapter.get(THREAD_PREFERENCE_KEYS.groups);
      const groups = normalizeThreadGroups(
        stored,
        await adapter.get(THREAD_PREFERENCE_KEYS.later),
      );
      const activeGroupPosition =
        typeof stored === "object" && stored !== null
          ? normalizeActiveGroupPosition(
              Reflect.get(stored, "activeGroupPosition"),
              groups.length,
            )
          : 0;
      return { groups, activeGroupPosition };
    },
    async saveGroups(groups: SidebarThreadGroup[], activeGroupPosition = 0) {
      const value = normalizeThreadGroups({ groups });
      const preferences = {
        groups: value,
        activeGroupPosition: normalizeActiveGroupPosition(
          activeGroupPosition,
          value.length,
        ),
      };
      await adapter.set(THREAD_PREFERENCE_KEYS.groups, preferences);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, preferences);
      return preferences;
    },
    appearance,
    async saveAppearance(rowHeight: number) {
      const validation = validateSidebarRowHeight(String(rowHeight));
      if (validation.value === null) throw new Error(validation.error);
      const value = validation.value;
      await adapter.set(THREAD_PREFERENCE_KEYS.appearance, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, {
        appearance: { rowHeight: value },
      });
      return appearance();
    },
    async saveTextScale(textScale: number) {
      const validation = validateTextScale(String(textScale));
      if (validation.value === null) throw new Error(validation.error);
      const value = validation.value;
      await adapter.set(THREAD_PREFERENCE_KEYS.textScale, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, {
        appearance: { textScale: value },
      });
      return appearance();
    },
  };
}
