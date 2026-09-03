import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { pluginStorageDatabase } from "../../shared/server-storage.js";

export const WORK_ITEM_QUEUE_KEY = "work-item-queue:v1";
const WORK_ITEM_QUEUE_MIGRATION_KEY = "work-item-queue-v1-imported";
const MAX_STORED_WORK_ITEM_QUEUES = 500;


type StoredReference = { source: "bb_task" | "linear"; id: string };
export type StoredWorkItemQueue = {
  current: StoredReference | null;
  backlog: StoredReference[];
};
export type PersistedWorkItemQueue = { configured: boolean; queue: StoredWorkItemQueue };

export type WorkItemQueueStore = {
  get(rootThreadId: string): Promise<unknown | undefined>;
  set(rootThreadId: string, queue: StoredWorkItemQueue): Promise<void>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function normalizeWorkItemQueue(value: unknown): StoredWorkItemQueue {
  if (!isRecord(value)) return { current: null, backlog: [] };
  const reference = (candidate: unknown): StoredReference | null =>
    isRecord(candidate) &&
    (candidate.source === "bb_task" || candidate.source === "linear") &&
    typeof candidate.id === "string" && candidate.id.trim()
      ? { source: candidate.source, id: candidate.id.trim() }
      : null;
  const current = reference(value.current);
  const seen = new Set(current ? [`${current.source}:${current.id.toUpperCase()}`] : []);
  const backlog = (Array.isArray(value.backlog) ? value.backlog : []).flatMap((candidate) => {
    const item = reference(candidate);
    const key = item && `${item.source}:${item.id.toUpperCase()}`;
    if (!item || !key || seen.has(key)) return [];
    seen.add(key);
    return [item];
  }).slice(0, 100);
  return { current, backlog };
}

/**
 * Root records are intentionally separate rows. The old single KV document
 * made every queue edit rewrite the complete history of the project.
 */
export function createSqliteWorkItemQueueStore(
  bb: Pick<BbPluginApi, "storage">,
): WorkItemQueueStore {
  let database: ReturnType<typeof pluginStorageDatabase> | null = null;
  const openDatabase = () => (database ??= pluginStorageDatabase(bb));
  let migration: Promise<void> | null = null;

  const migrated = () => Boolean(
    openDatabase()
      .prepare<[string], { value: string }>(
        "SELECT value FROM work_item_queue_metadata WHERE key = ?",
      )
      .get(WORK_ITEM_QUEUE_MIGRATION_KEY),
  );
  const ensureMigrated = async () => {
    if (!migration) {
      migration = (async () => {
        if (migrated()) return;
        const database = openDatabase();
        const saved = await bb.storage.kv.get<unknown>(WORK_ITEM_QUEUE_KEY);
        if (isRecord(saved)) {
          const insert = database.prepare(
            `INSERT INTO work_item_queue_state (root_thread_id, queue_json, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(root_thread_id) DO NOTHING`,
          );
          const now = new Date().toISOString();
          for (const [rootThreadId, value] of Object.entries(saved)) {
            if (rootThreadId.startsWith("thr_"))
              insert.run(rootThreadId, JSON.stringify(normalizeWorkItemQueue(value)), now);
          }
        }
        database
          .prepare(
            `INSERT INTO work_item_queue_metadata (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO NOTHING`,
          )
          .run(WORK_ITEM_QUEUE_MIGRATION_KEY, new Date().toISOString());
        await bb.storage.kv.delete(WORK_ITEM_QUEUE_KEY);
      })();
    }
    await migration;
  };
  const trim = (excluding: string) => {
    const database = openDatabase();
    const count = database
      .prepare<[], { count: number }>(
        "SELECT COUNT(*) AS count FROM work_item_queue_state",
      )
      .get()?.count ?? 0;
    const excess = count - MAX_STORED_WORK_ITEM_QUEUES;
    if (excess <= 0) return;
    const stale = database
      .prepare<[string, number], { root_thread_id: string }>(
        `SELECT root_thread_id FROM work_item_queue_state
         WHERE root_thread_id <> ?
         ORDER BY updated_at ASC, root_thread_id ASC
         LIMIT ?`,
      )
      .all(excluding, excess);
    const remove = database.prepare<[string]>(
      "DELETE FROM work_item_queue_state WHERE root_thread_id = ?",
    );
    for (const row of stale) remove.run(row.root_thread_id);
  };

  return {
    async get(rootThreadId) {
      await ensureMigrated();
      const row = openDatabase()
        .prepare<[string], { queue_json: string }>(
          "SELECT queue_json FROM work_item_queue_state WHERE root_thread_id = ?",
        )
        .get(rootThreadId);
      if (!row) return undefined;
      try {
        return normalizeWorkItemQueue(JSON.parse(row.queue_json));
      } catch {
        return normalizeWorkItemQueue(undefined);
      }
    },
    async set(rootThreadId, queue) {
      await ensureMigrated();
      openDatabase()
        .prepare(
          `INSERT INTO work_item_queue_state (root_thread_id, queue_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(root_thread_id) DO UPDATE SET
             queue_json = excluded.queue_json,
             updated_at = excluded.updated_at`,
        )
        .run(rootThreadId, JSON.stringify(normalizeWorkItemQueue(queue)), new Date().toISOString());
      trim(rootThreadId);
    },
  };
}

export function createWorkItemQueueService(dependencies: WorkItemQueueStore & {
  publish(rootThreadId: string): void;
  ensureOutcome(input: { rootThreadId: string; title: string; description: string }): unknown | Promise<unknown>;
  createExecution(input: { rootThreadId: string; title: string; description: string; idempotencyKey: string; assignee: "agent" }): { task: { id: string } } | Promise<{ task: { id: string } }>;
}) {
  const read = async (rootThreadId: string) => {
    const saved = await dependencies.get(rootThreadId);
    const configured = saved !== undefined;
    return {
      configured,
      queue: configured ? normalizeWorkItemQueue(saved) : { current: null, backlog: [] },
    };
  };
  const write = async (rootThreadId: string, queue: StoredWorkItemQueue) => {
    await dependencies.set(rootThreadId, queue);
    dependencies.publish(rootThreadId);
    return { configured: true, queue };
  };
  const moveToExecution = async (rootThreadId: string, reference: StoredReference, title: string, description: string) => {
    const existing = (await read(rootThreadId)).queue;
    const matches = (item: StoredReference | null) => item?.source === reference.source && item.id.toUpperCase() === reference.id.toUpperCase();
    if (![existing.current, ...existing.backlog].some(matches)) throw new Error("This work item is not a current goal or backlog entry.");
    const remaining = existing.backlog.filter((item) => !matches(item));
    if (matches(existing.current) && remaining.length === 0) {
      throw new Error("Add a backlog goal before moving the current goal to tasks.");
    }
    await dependencies.ensureOutcome({ rootThreadId, title: `Outcome for ${title}`, description: "Created while moving a work goal into execution." });
    const execution = await dependencies.createExecution({
      rootThreadId,
      title,
      description: `${description}\n\nWork-item source: ${reference.source}:${reference.id}`.trim(),
      idempotencyKey: `work-item-execution:${reference.source}:${reference.id}`,
      assignee: "agent",
    });
    const next = matches(existing.current)
      ? { current: remaining[0] ?? null, backlog: remaining.slice(1) }
      : { current: existing.current, backlog: remaining };
    return { taskId: execution.task.id, ...(await write(rootThreadId, next)) };
  };
  return { read, write, moveToExecution };
}
