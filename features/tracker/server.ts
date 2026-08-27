import { z } from "zod";
import { taskboardDetailSchema, taskboardItemSchema, taskboardStatusOptionSchema, trackerContextSchema, type TrackerContext } from "./schemas.js";

export const TRACKER_LINKS_KEY = "work-linear-links:v1";
export const TASKBOARD_PLUGIN_ID = "taskboard";
type Link = { projectId: string; locator: string; key: string };
type Links = Record<string, Link>;

export type TrackerServiceDependencies = {
  call<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T>;
  getStorage(): Promise<unknown>;
  setStorage(value: Links): Promise<void>;
  rootThread(threadId: string): Promise<{ id: string; projectId: string }>;
  threadTitle(threadId: string): Promise<string>;
  publish(rootThreadId: string): void;
};

function linksFrom(value: unknown): Links {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).flatMap(([threadId, link]) => {
    if (!threadId.startsWith("thr_") || !link || typeof link !== "object" || Array.isArray(link)) return [];
    const row = link as Record<string, unknown>;
    return typeof row.projectId === "string" && typeof row.locator === "string" && typeof row.key === "string"
      ? [[threadId, { projectId: row.projectId, locator: row.locator, key: row.key }]] : [];
  }));
}

function unavailable(error: unknown): TrackerContext {
  const message = error instanceof Error ? error.message : "Linear is unavailable.";
  return { visible: !/Linear is not the selected tracker/i.test(message), available: false, message, suggestions: [], item: null, statusOptions: [] };
}

/** Server-only Taskboard adapter; all plugin responses are schema-validated. */
export function createTrackerService(dependencies: TrackerServiceDependencies) {
  const links = async () => linksFrom(await dependencies.getStorage());
  const list = (projectId: string, query: string, limit: number) => dependencies.call("listItems", { projectId, source: "linear", query, limit }, z.object({ items: z.array(taskboardItemSchema) }));
  const suggestions = async (projectId: string, title: string) => {
    const matching = await list(projectId, title, 8);
    return matching.items.length || !title.trim() ? matching : list(projectId, "", 8);
  };
  return {
    async context(threadId: string): Promise<TrackerContext> {
      const [root, title, stored] = await Promise.all([dependencies.rootThread(threadId), dependencies.threadTitle(threadId), links()]);
      try {
        const suggested = suggestions(root.projectId, title);
        const link = stored[root.id];
        if (!link) {
          const { items } = await suggested;
          return trackerContextSchema.parse({ visible: true, available: true, message: null, suggestions: items.map(({ key, title: itemTitle, url }) => ({ key, title: itemTitle, url })), item: null, statusOptions: [] });
        }
        const [{ item }, { options }, { items }] = await Promise.all([
          dependencies.call("getItem", { projectId: link.projectId, source: "linear", locator: link.locator }, z.object({ item: taskboardDetailSchema })),
          dependencies.call("statusOptions", { projectId: link.projectId, source: "linear", locator: link.locator }, z.object({ options: z.array(taskboardStatusOptionSchema) })), suggested,
        ]);
        return trackerContextSchema.parse({ visible: true, available: true, message: null, suggestions: items.map(({ key, title: itemTitle, url }) => ({ key, title: itemTitle, url })), item: { key: item.key, title: item.title, url: item.url, status: item.status, stateCategory: item.stateCategory, priority: item.priority, assignee: item.assignee, project: item.project }, statusOptions: options.map(({ id, name, current }) => ({ id, name, current })) });
      } catch (error) { return unavailable(error); }
    },
    async search(threadId: string, query: string) {
      const trimmed = query.trim(); if (!trimmed) return { items: [] };
      const root = await dependencies.rootThread(threadId);
      const { items } = await list(root.projectId, trimmed, 20);
      return { items: items.map(({ key, title, url }) => ({ key, title, url })) };
    },
    async link(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId); const normalized = key.trim().toUpperCase();
      const { items } = await list(root.projectId, normalized, 30);
      const item = items.find((candidate) => candidate.key.toUpperCase() === normalized);
      if (!item) throw new Error(`No Linear issue matching ${normalized} was found in this BB project.`);
      await dependencies.setStorage({ ...(await links()), [root.id]: { projectId: root.projectId, locator: item.locator, key: item.key } });
      dependencies.publish(root.id); return { key: item.key, title: item.title };
    },
    async unlink(threadId: string) {
      const root = await dependencies.rootThread(threadId); const stored = await links(); delete stored[root.id];
      await dependencies.setStorage(stored); dependencies.publish(root.id); return { ok: true as const };
    },
    async updateStatus(threadId: string, statusId: string) {
      const root = await dependencies.rootThread(threadId); const link = (await links())[root.id];
      if (!link) throw new Error("Link a Linear issue before changing its status.");
      const { item } = await dependencies.call("updateItemStatus", { projectId: link.projectId, source: "linear", locator: link.locator, statusId }, z.object({ item: taskboardItemSchema }));
      dependencies.publish(root.id); return { key: item.key, status: item.status };
    },
  };
}
