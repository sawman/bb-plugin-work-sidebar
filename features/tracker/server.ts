import { z } from "zod";
import type { PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import {
  taskboardDetailSchema,
  taskboardItemSchema,
  taskboardStatusOptionSchema,
  trackerContextSchema,
  type TrackerContext,
} from "./schemas.js";

export const TRACKER_LINKS_KEY = "work-linear-links:v1";
export const TASKBOARD_PLUGIN_ID = "taskboard";
type Link = { projectId: string; locator: string; key: string };
type Links = Record<string, Link[]>;

export type TrackerServiceDependencies = {
  call<T>(
    method: string,
    input: PluginRpcInput,
    outputSchema: z.ZodType<T>,
  ): Promise<T>;
  getStorage(): Promise<unknown>;
  setStorage(value: Links): Promise<void>;
  rootThread(threadId: string): Promise<{ id: string; projectId: string }>;
  threadTitle(threadId: string): Promise<string>;
  publish(rootThreadId: string): void;
};

function linkFrom(value: unknown): Link | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  return typeof row.projectId === "string" &&
    typeof row.locator === "string" &&
    typeof row.key === "string"
    ? { projectId: row.projectId, locator: row.locator, key: row.key }
    : null;
}

/** Reads both the v1 single-link record and the additive array shape. */
function linksFrom(value: unknown): Links {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).flatMap(([threadId, stored]) => {
      if (!threadId.startsWith("thr_")) return [];
      const candidates = Array.isArray(stored) ? stored : [stored];
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
      return links.length ? [[threadId, links]] : [];
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
    suggestions: [],
    items: [],
  };
}

/** Server-only Taskboard adapter; all plugin responses are schema-validated. */
export function createTrackerService(dependencies: TrackerServiceDependencies) {
  const links = async () => linksFrom(await dependencies.getStorage());
  const list = (projectId: string, query: string, limit: number) =>
    dependencies.call(
      "listItems",
      { projectId, source: "linear", query, limit },
      z.object({ items: z.array(taskboardItemSchema) }),
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
        const rootLinks = stored[root.id] ?? [];
        const [linkedItems, { items: suggestedItems }] = await Promise.all([
          Promise.all(
            rootLinks.map(async (link) => {
              const [{ item }, { options }] = await Promise.all([
                dependencies.call(
                  "getItem",
                  {
                    projectId: link.projectId,
                    source: "linear",
                    locator: link.locator,
                  },
                  z.object({ item: taskboardDetailSchema }),
                ),
                dependencies.call(
                  "statusOptions",
                  {
                    projectId: link.projectId,
                    source: "linear",
                    locator: link.locator,
                  },
                  z.object({
                    options: z.array(taskboardStatusOptionSchema),
                  }),
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
      const rootLinks = stored[root.id] ?? [];
      if (
        rootLinks.some(
          (link) => link.key.toUpperCase() === item.key.toUpperCase(),
        )
      )
        return { key: item.key, title: item.title };
      await dependencies.setStorage({
        ...stored,
        [root.id]: [
          ...rootLinks,
          {
            projectId: root.projectId,
            locator: item.locator,
            key: item.key,
          },
        ],
      });
      dependencies.publish(root.id);
      return { key: item.key, title: item.title };
    },
    async unlink(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const stored = await links();
      const normalized = key.trim().toUpperCase();
      const rootLinks = stored[root.id] ?? [];
      const nextLinks = rootLinks.filter(
        (link) => link.key.toUpperCase() !== normalized,
      );
      if (nextLinks.length === rootLinks.length)
        throw new Error(`${normalized} is not linked to this work thread.`);
      if (nextLinks.length) stored[root.id] = nextLinks;
      else delete stored[root.id];
      await dependencies.setStorage(stored);
      dependencies.publish(root.id);
      return { ok: true as const };
    },
    async updateStatus(threadId: string, key: string, statusId: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const link = (await links())[root.id]?.find(
        (candidate) => candidate.key.toUpperCase() === normalized,
      );
      if (!link)
        throw new Error(`${normalized} is not linked to this work thread.`);
      const { item } = await dependencies.call(
        "updateItemStatus",
        {
          projectId: link.projectId,
          source: "linear",
          locator: link.locator,
          statusId,
        },
        z.object({ item: taskboardItemSchema }),
      );
      dependencies.publish(root.id);
      return { key: item.key, status: item.status };
    },
  };
}
