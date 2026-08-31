import { z } from "zod";
import type { PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import {
  taskboardDetailSchema,
  taskboardItemSchema,
  taskboardRefreshSchema,
  taskboardStatusOptionSchema,
  trackerContextSchema,
  type TrackerContext,
} from "./schemas.js";

export const TRACKER_LINKS_KEY = "work-linear-links:v2";
export const LEGACY_TRACKER_LINKS_KEY = "work-linear-links:v1";
export const TASKBOARD_PLUGIN_ID = "taskboard";
type Link = { projectId: string; locator: string; key: string };
type LinkState = { keys: Link[]; primaryKey: string | null };
type Links = Record<string, LinkState>;

export type TrackerServiceDependencies = {
  call<T>(
    method: string,
    input: PluginRpcInput,
    outputSchema: z.ZodType<T>,
  ): Promise<T>;
  getStorage(key: string): Promise<unknown>;
  setStorage(value: Links): Promise<void>;
  rootThread(threadId: string): Promise<{ id: string; projectId: string }>;
  threadTitle(threadId: string): Promise<string>;
  publish(rootThreadId: string): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function linkFrom(value: unknown): Link | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.projectId === "string" &&
    typeof row.locator === "string" &&
    typeof row.key === "string"
    ? { projectId: row.projectId, locator: row.locator, key: row.key }
    : null;
}

/** Recovers valid links while keeping each v2 primary tied to its list. */
function linksFrom(value: unknown, version: "v1" | "v2"): Links {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([threadId, stored]) => {
      if (!threadId.startsWith("thr_")) return [];
      const v2State = version === "v2" && isRecord(stored) ? stored : null;
      const candidates = v2State
        ? Array.isArray(v2State.keys)
          ? v2State.keys
          : []
        : Array.isArray(stored)
          ? stored
          : [stored];
      const links = candidates
        .map(linkFrom)
        .filter((link): link is Link => link !== null)
        .filter(
          (link, index, all) =>
            all.findIndex(
              (candidate) =>
                candidate.key.toUpperCase() === link.key.toUpperCase(),
            ) === index,
        );
      if (!links.length) return [];
      const storedPrimary = v2State?.primaryKey;
      const primary =
        typeof storedPrimary === "string"
          ? links.find(
              (link) => link.key.toUpperCase() === storedPrimary.toUpperCase(),
            )
          : undefined;
      return [
        [threadId, { keys: links, primaryKey: (primary ?? links[0])!.key }],
      ];
    }),
  );
}

function unavailable(error: unknown): TrackerContext {
  const message =
    error instanceof Error ? error.message : "Linear is unavailable.";
  return {
    visible: !/Linear is not the selected tracker/i.test(message),
    available: false,
    message,
    primaryKey: null,
    suggestions: [],
    items: [],
  };
}

/** Server-only Taskboard adapter; all plugin responses are schema-validated. */
export function createTrackerService(dependencies: TrackerServiceDependencies) {
  const refreshes = new Map<string, Promise<void>>();
  const refresh = (projectId: string, source: "linear") => {
    const refreshKey = `${projectId}:${source}`;
    const pending = refreshes.get(refreshKey);
    if (pending) return pending;
    const started = dependencies
      .call("refresh", { projectId, source }, taskboardRefreshSchema)
      .then(() => undefined)
      .finally(() => {
        if (refreshes.get(refreshKey) === started) refreshes.delete(refreshKey);
      });
    refreshes.set(refreshKey, started);
    return started;
  };
  const callWithCacheRecovery = async <T>(
    method: string,
    input: PluginRpcInput & { projectId: string; source: "linear" },
    outputSchema: z.ZodType<T>,
  ) => {
    try {
      return await dependencies.call(method, input, outputSchema);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        !/Linear item is not cached for this BB project; refresh the project tracker first/i.test(
          message,
        )
      )
        throw error;
      await refresh(input.projectId, input.source);
      try {
        return await dependencies.call(method, input, outputSchema);
      } catch (retryError) {
        const retryMessage =
          retryError instanceof Error ? retryError.message : String(retryError);
        if (/item is not cached for this BB project/i.test(retryMessage))
          throw new Error(
            "Linear could not find this item after refreshing the BB project tracker.",
          );
        throw retryError;
      }
    }
  };
  const links = async () => {
    const current = await dependencies.getStorage(TRACKER_LINKS_KEY);
    if (current !== undefined && current !== null)
      return linksFrom(current, "v2");
    return linksFrom(
      await dependencies.getStorage(LEGACY_TRACKER_LINKS_KEY),
      "v1",
    );
  };
  const list = (projectId: string, query: string, limit: number) =>
    dependencies.call(
      "listItems",
      { projectId, source: "linear", query, limit },
      z.object({ items: z.array(taskboardItemSchema) }).strict(),
    );
  const suggestions = async (projectId: string, title: string) => {
    const matching = await list(projectId, title, 8);
    return matching.items.length || !title.trim()
      ? matching
      : list(projectId, "", 8);
  };
  return {
    async context(threadId: string): Promise<TrackerContext> {
      const [root, title, stored] = await Promise.all([
        dependencies.rootThread(threadId),
        dependencies.threadTitle(threadId),
        links(),
      ]);
      try {
        const suggested = suggestions(root.projectId, title);
        const rootLinks = stored[root.id] ?? { keys: [], primaryKey: null };
        const [linkedItems, { items: suggestedItems }] = await Promise.all([
          Promise.all(
            rootLinks.keys.map(async (link) => {
              const [{ item }, { options }] = await Promise.all([
                callWithCacheRecovery(
                  "getItem",
                  {
                    projectId: link.projectId,
                    source: "linear",
                    locator: link.locator,
                  },
                  z.object({ item: taskboardDetailSchema }).strict(),
                ),
                callWithCacheRecovery(
                  "statusOptions",
                  {
                    projectId: link.projectId,
                    source: "linear",
                    locator: link.locator,
                  },
                  z
                    .object({ options: z.array(taskboardStatusOptionSchema) })
                    .strict(),
                ),
              ]);
              return {
                item: {
                  key: item.key,
                  title: item.title,
                  url: item.url,
                  status: item.status,
                  stateCategory: item.stateCategory,
                  priority: item.priority,
                  assignee: item.assignee,
                  project: item.project,
                },
                statusOptions: options.map(({ id, name, current }) => ({
                  id,
                  name,
                  current,
                })),
              };
            }),
          ),
          suggested,
        ]);
        const linkedKeys = new Set(
          linkedItems.map(({ item }) => item.key.toUpperCase()),
        );
        return trackerContextSchema.parse({
          visible: true,
          available: true,
          message: null,
          primaryKey: rootLinks.primaryKey,
          suggestions: suggestedItems
            .filter((item) => !linkedKeys.has(item.key.toUpperCase()))
            .map(({ key, title: itemTitle, url }) => ({
              key,
              title: itemTitle,
              url,
            })),
          items: linkedItems,
        });
      } catch (error) {
        return unavailable(error);
      }
    },
    async search(threadId: string, query: string) {
      const trimmed = query.trim();
      if (!trimmed) return { items: [] };
      const root = await dependencies.rootThread(threadId);
      const { items } = await list(root.projectId, trimmed, 20);
      return {
        items: items.map(({ key, title, url }) => ({ key, title, url })),
      };
    },
    async link(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const { items } = await list(root.projectId, normalized, 30);
      const item = items.find(
        (candidate) => candidate.key.toUpperCase() === normalized,
      );
      if (!item)
        throw new Error(
          `No Linear issue matching ${normalized} was found in this BB project.`,
        );
      const stored = await links();
      const rootLinks = stored[root.id] ?? { keys: [], primaryKey: null };
      if (
        rootLinks.keys.some(
          (link) => link.key.toUpperCase() === item.key.toUpperCase(),
        )
      )
        return { key: item.key, title: item.title };
      await dependencies.setStorage({
        ...stored,
        [root.id]: {
          keys: [
            ...rootLinks.keys,
            {
              projectId: root.projectId,
              locator: item.locator,
              key: item.key,
            },
          ],
          primaryKey: rootLinks.primaryKey ?? item.key,
        },
      });
      dependencies.publish(root.id);
      return { key: item.key, title: item.title };
    },
    async unlink(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const stored = await links();
      const normalized = key.trim().toUpperCase();
      const rootLinks = stored[root.id] ?? { keys: [], primaryKey: null };
      const nextLinks = rootLinks.keys.filter(
        (link) => link.key.toUpperCase() !== normalized,
      );
      if (nextLinks.length === rootLinks.keys.length)
        throw new Error(`${normalized} is not linked to this work thread.`);
      if (nextLinks.length)
        stored[root.id] = {
          keys: nextLinks,
          primaryKey:
            rootLinks.primaryKey?.toUpperCase() === normalized
              ? nextLinks[0]!.key
              : (rootLinks.primaryKey ?? nextLinks[0]!.key),
        };
      else delete stored[root.id];
      await dependencies.setStorage(stored);
      dependencies.publish(root.id);
      return { ok: true as const };
    },
    async setPrimary(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const stored = await links();
      const normalized = key.trim().toUpperCase();
      const rootLinks = stored[root.id] ?? { keys: [], primaryKey: null };
      const primary = rootLinks.keys.find(
        (link) => link.key.toUpperCase() === normalized,
      );
      if (!primary)
        throw new Error(`${normalized} is not linked to this work thread.`);
      if (rootLinks.primaryKey === primary.key) return { key: primary.key };
      await dependencies.setStorage({
        ...stored,
        [root.id]: { ...rootLinks, primaryKey: primary.key },
      });
      dependencies.publish(root.id);
      return { key: primary.key };
    },
    async updateStatus(threadId: string, key: string, statusId: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const link = (await links())[root.id]?.keys.find(
        (candidate) => candidate.key.toUpperCase() === normalized,
      );
      if (!link)
        throw new Error(`${normalized} is not linked to this work thread.`);
      const { item } = await callWithCacheRecovery(
        "updateItemStatus",
        {
          projectId: link.projectId,
          source: "linear",
          locator: link.locator,
          statusId,
        },
        z.object({ item: taskboardItemSchema }).strict(),
      );
      dependencies.publish(root.id);
      return { key: item.key, status: item.status };
    },
  };
}
