import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import type { PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import { pluginStorageDatabase } from "../../shared/server-storage.js";
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
const TRACKER_LINKS_MIGRATION_KEY = "work-linear-links-v2-imported";
const MAX_STORED_TRACKER_LINKS = 500;
const MAX_LINKS_PER_ROOT = 100;
type Link = { projectId: string; locator: string; key: string };
export type LinkState = { keys: Link[]; primaryKey: string | null };
type Links = Record<string, LinkState>;

export type TrackerLinkStore = {
  get(rootThreadId: string): Promise<LinkState | undefined>;
  set(rootThreadId: string, state: LinkState | null): Promise<void>;
};

export type TrackerServiceDependencies = {
  call<T>(
    method: string,
    input: PluginRpcInput,
    outputSchema: z.ZodType<T>,
  ): Promise<T>;
  links: TrackerLinkStore;
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
        )
        .slice(0, MAX_LINKS_PER_ROOT);
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

/** Stores each root's Linear links independently and imports the old KV map once. */
export function createSqliteTrackerLinkStore(
  bb: Pick<BbPluginApi, "storage">,
): TrackerLinkStore {
  let database: ReturnType<typeof pluginStorageDatabase> | null = null;
  const openDatabase = () => (database ??= pluginStorageDatabase(bb));
  let migration: Promise<void> | null = null;
  const migrated = () => Boolean(
    openDatabase()
      .prepare<[string], { value: string }>(
        "SELECT value FROM tracker_link_metadata WHERE key = ?",
      )
      .get(TRACKER_LINKS_MIGRATION_KEY),
  );
  const ensureMigrated = async () => {
    if (!migration) {
      migration = (async () => {
        if (migrated()) return;
        const database = openDatabase();
        const v2 = await bb.storage.kv.get<unknown>(TRACKER_LINKS_KEY);
        const recovered = v2 === undefined || v2 === null
          ? linksFrom(
              await bb.storage.kv.get<unknown>(LEGACY_TRACKER_LINKS_KEY),
              "v1",
            )
          : linksFrom(v2, "v2");
        const insert = database.prepare(
          `INSERT INTO tracker_link_state (root_thread_id, links_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(root_thread_id) DO NOTHING`,
        );
        const now = new Date().toISOString();
        for (const [rootThreadId, state] of Object.entries(recovered))
          insert.run(rootThreadId, JSON.stringify(state), now);
        database
          .prepare(
            `INSERT INTO tracker_link_metadata (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO NOTHING`,
          )
          .run(TRACKER_LINKS_MIGRATION_KEY, new Date().toISOString());
        await Promise.all([
          bb.storage.kv.delete(TRACKER_LINKS_KEY),
          bb.storage.kv.delete(LEGACY_TRACKER_LINKS_KEY),
        ]);
      })();
    }
    await migration;
  };
  const trim = (excluding: string) => {
    const database = openDatabase();
    const count = database
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM tracker_link_state",
      )
      .get()?.count ?? 0;
    const excess = count - MAX_STORED_TRACKER_LINKS;
    if (excess <= 0) return;
    const stale = database
      .prepare<[string, number], { root_thread_id: string }>(
        `SELECT root_thread_id FROM tracker_link_state
         WHERE root_thread_id <> ?
         ORDER BY updated_at ASC, root_thread_id ASC
         LIMIT ?`,
      )
      .all(excluding, excess);
    const remove = database.prepare<[string]>(
      "DELETE FROM tracker_link_state WHERE root_thread_id = ?",
    );
    for (const row of stale) remove.run(row.root_thread_id);
  };

  return {
    async get(rootThreadId) {
      await ensureMigrated();
      const row = openDatabase()
        .prepare<[string], { links_json: string }>(
          "SELECT links_json FROM tracker_link_state WHERE root_thread_id = ?",
        )
        .get(rootThreadId);
      if (!row) return undefined;
      try {
        return linksFrom({ [rootThreadId]: JSON.parse(row.links_json) }, "v2")[rootThreadId];
      } catch {
        return undefined;
      }
    },
    async set(rootThreadId, state) {
      await ensureMigrated();
      if (!state) {
        openDatabase()
          .prepare<[string]>("DELETE FROM tracker_link_state WHERE root_thread_id = ?")
          .run(rootThreadId);
        return;
      }
      openDatabase()
        .prepare(
          `INSERT INTO tracker_link_state (root_thread_id, links_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(root_thread_id) DO UPDATE SET
             links_json = excluded.links_json,
             updated_at = excluded.updated_at`,
        )
        .run(rootThreadId, JSON.stringify(state), new Date().toISOString());
      trim(rootThreadId);
    },
  };
}

function unavailable(error: unknown): TrackerContext {
  const detail =
    error instanceof Error ? error.message : "Linear is unavailable.";
  const taskboardMissing = /(?:taskboard.*(?:not installed|not found)|(?:not installed|not found).*taskboard)/i.test(detail);
  return {
    visible: !/Linear is not the selected tracker/i.test(detail),
    available: false,
    message: taskboardMissing
      ? "Linear integration is unavailable because the optional Taskboard plugin is not installed."
      : detail,
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
      const [root, title] = await Promise.all([
        dependencies.rootThread(threadId),
        dependencies.threadTitle(threadId),
      ]);
      try {
        const suggested = suggestions(root.projectId, title);
        const rootLinks = await dependencies.links.get(root.id) ?? {
          keys: [],
          primaryKey: null,
        };
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
      const rootLinks = await dependencies.links.get(root.id) ?? {
        keys: [],
        primaryKey: null,
      };
      if (
        rootLinks.keys.some(
          (link) => link.key.toUpperCase() === item.key.toUpperCase(),
        )
      )
        return { key: item.key, title: item.title };
      if (rootLinks.keys.length >= MAX_LINKS_PER_ROOT)
        throw new Error("A work thread can link at most 100 Linear issues.");
      await dependencies.links.set(root.id, {
          keys: [
            ...rootLinks.keys,
            {
              projectId: root.projectId,
              locator: item.locator,
              key: item.key,
            },
          ],
          primaryKey: rootLinks.primaryKey ?? item.key,
      });
      dependencies.publish(root.id);
      return { key: item.key, title: item.title };
    },
    async unlink(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const rootLinks = await dependencies.links.get(root.id) ?? {
        keys: [],
        primaryKey: null,
      };
      const nextLinks = rootLinks.keys.filter(
        (link) => link.key.toUpperCase() !== normalized,
      );
      if (nextLinks.length === rootLinks.keys.length)
        throw new Error(`${normalized} is not linked to this work thread.`);
      if (nextLinks.length)
        await dependencies.links.set(root.id, {
          keys: nextLinks,
          primaryKey:
            rootLinks.primaryKey?.toUpperCase() === normalized
              ? nextLinks[0]!.key
              : (rootLinks.primaryKey ?? nextLinks[0]!.key),
        });
      else await dependencies.links.set(root.id, null);
      dependencies.publish(root.id);
      return { ok: true as const };
    },
    async setPrimary(threadId: string, key: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const rootLinks = await dependencies.links.get(root.id) ?? {
        keys: [],
        primaryKey: null,
      };
      const primary = rootLinks.keys.find(
        (link) => link.key.toUpperCase() === normalized,
      );
      if (!primary)
        throw new Error(`${normalized} is not linked to this work thread.`);
      if (rootLinks.primaryKey === primary.key) return { key: primary.key };
      await dependencies.links.set(root.id, { ...rootLinks, primaryKey: primary.key });
      dependencies.publish(root.id);
      return { key: primary.key };
    },
    async updateStatus(threadId: string, key: string, statusId: string) {
      const root = await dependencies.rootThread(threadId);
      const normalized = key.trim().toUpperCase();
      const link = (await dependencies.links.get(root.id))?.keys.find(
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
