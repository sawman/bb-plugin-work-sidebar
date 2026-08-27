import { normalizeThreadGroups, type SidebarThreadGroup } from "./model";

export const THREAD_PREFERENCE_CHANNEL = "sidebar-order:changed";
export const THREAD_PREFERENCE_KEYS = {
  order: "sidebar-thread-order:v1",
  listMode: "sidebar-thread-list-mode:v1",
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

type Storage = { get(key: string): Promise<unknown>; set(key: string, value: unknown): Promise<void> };
type ThreadPreferenceAdapter = { get: Storage["get"]; set: Storage["set"]; publish(channel: string, payload: unknown): void };

/** Server adapter for durable preferences only. Archive/delete stay BB native actions. */
export function createThreadPreferencesService(adapter: ThreadPreferenceAdapter) {
  return {
    async order() { return sanitizeThreadOrder(await adapter.get(THREAD_PREFERENCE_KEYS.order)); },
    async saveOrder(threadIds: unknown) {
      const value = sanitizeThreadOrder(threadIds);
      await adapter.set(THREAD_PREFERENCE_KEYS.order, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { threadIds: value });
      return value;
    },
    async listMode() { return (await adapter.get(THREAD_PREFERENCE_KEYS.listMode)) === "native" ? "native" as const : "enhanced" as const; },
    async saveListMode(mode: "enhanced" | "native") { await adapter.set(THREAD_PREFERENCE_KEYS.listMode, mode); return mode; },
    async later() { return sanitizeThreadOrder(await adapter.get(THREAD_PREFERENCE_KEYS.later)); },
    async saveLater(threadIds: unknown) {
      const value = sanitizeThreadOrder(threadIds);
      await adapter.set(THREAD_PREFERENCE_KEYS.later, value);
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { threadIds: value });
      return value;
    },
    async groups(): Promise<SidebarThreadGroup[]> {
      return normalizeThreadGroups(await adapter.get(THREAD_PREFERENCE_KEYS.groups), await adapter.get(THREAD_PREFERENCE_KEYS.later));
    },
    async saveGroups(groups: SidebarThreadGroup[]) {
      const value = normalizeThreadGroups({ groups });
      await adapter.set(THREAD_PREFERENCE_KEYS.groups, { groups: value });
      adapter.publish(THREAD_PREFERENCE_CHANNEL, { groups: value });
      return value;
    },
  };
}
