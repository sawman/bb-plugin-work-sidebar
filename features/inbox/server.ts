import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import type { HumanMessage } from "./schemas.js";

type Database = ReturnType<BbPluginApi["storage"]["database"]>;
type Thread = { id: string; projectId: string; archivedAt: unknown };
type Cursor = { updatedAt: string; id: string };
type CreateInput = {
  threadId: string; projectId: string; body: string; subject?: string | null;
  agentThreadId?: string | null;
  providerId?: string | null;
  agentLabel?: string | null;
  idempotencyKey?: string;
};
export type InboxCreateResult = HumanMessage & { changed: boolean };

export const MAX_HUMAN_MESSAGES_PER_THREAD = 500;
export const INBOX_AGENT_INSTRUCTIONS = [
  "Leave a human Inbox message for key answers, decisions, blockers, warnings,",
  "or handoff information the user may need later. Do not mirror routine progress",
  "or every chat response. Ask interactive questions through the question tool;",
  "when the question or its answer is important, also leave a concise Inbox record.",
].join(" ");

function normalizeSubject(subject: string | null | undefined): string | null {
  const value = subject?.trim() ?? "";
  return value || null;
}

// Zod's string max counts UTF-16 code units. Do not split a surrogate pair
// at the boundary; apply on reads too so legacy metadata cannot reject a page.
function normalizeAgentLabel(label: string | null | undefined): string | null {
  const value = label?.trim() ?? "";
  const bounded = value.slice(0, 160).replace(/[\uD800-\uDBFF]$/, "");
  return bounded || null;
}

function messageFrom(row: Record<string, unknown>): HumanMessage {
  return {
    id: String(row.id), threadId: String(row.thread_id), projectId: String(row.project_id),
    subject: row.subject === null ? null : String(row.subject), body: String(row.body),
    agentThreadId: row.agent_thread_id === null ? null : String(row.agent_thread_id),
    providerId: row.provider_id === null ? null : String(row.provider_id),
    agentLabel: normalizeAgentLabel(row.agent_label === null ? null : String(row.agent_label)),
    createdAt: String(row.created_at), updatedAt: String(row.updated_at),
    acknowledgedAt: row.acknowledged_at === null ? null : String(row.acknowledged_at),
    bookmarkedAt: row.bookmarked_at === null ? null : String(row.bookmarked_at),
    revision: Number(row.revision),
  };
}

function cursorFrom(value: string | undefined): Cursor | null {
  if (!value) return null;
  try {
    const cursor = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    return typeof cursor.updatedAt === "string" && typeof cursor.id === "string" ? cursor : null;
  } catch {
    return null;
  }
}

function cursorFor(message: HumanMessage): string {
  return Buffer.from(JSON.stringify({ updatedAt: message.updatedAt, id: message.id })).toString("base64url");
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function notFound(): never {
  throw new Error("Human Inbox message not found.");
}

function conflict(): never {
  throw new Error("Human Inbox message changed; refresh and retry.");
}

/** SQLite-backed, thread-authorized Inbox dataset. SQL policy stays in this slice. */
export function createInboxService({
  database,
  now = () => new Date().toISOString(),
  createId = () => `msg_${randomUUID().replace(/-/g, "")}`,
  getThread,
}: {
  database: Database;
  now?: () => string;
  createId?: () => string;
  getThread(threadId: string): Promise<Thread>;
}) {
  let disposed = false;
  const assertActive = () => {
    if (disposed) throw new Error("Human Inbox service is disposed.");
  };
  type LifecycleGuard = { generation: number; inFlightCreates: number; purgeFailed: boolean };
  const lifecycleGuards = new Map<string, LifecycleGuard>();
  const guardFor = (threadId: string) => {
    let guard = lifecycleGuards.get(threadId);
    if (!guard) {
      guard = { generation: 0, inFlightCreates: 0, purgeFailed: false };
      lifecycleGuards.set(threadId, guard);
    }
    return guard;
  };
  const releaseGuard = (threadId: string, guard: LifecycleGuard) => {
    if (!guard.purgeFailed && guard.inFlightCreates === 0 && lifecycleGuards.get(threadId) === guard)
      lifecycleGuards.delete(threadId);
  };
  const one = (threadId: string, id: string) =>
    database.prepare("SELECT * FROM human_inbox_messages WHERE thread_id = ? AND id = ?").get(threadId, id) as Record<string, unknown> | undefined;
  const requireOne = (threadId: string, id: string, expectedRevision?: number) => {
    const row = one(threadId, id);
    if (!row) notFound();
    if (expectedRevision !== undefined && Number(row.revision) !== expectedRevision) conflict();
    return row;
  };
  const retain = (threadId: string, incomingId: string | null = null) => {
    const count = database.prepare(
      "SELECT COUNT(*) AS count FROM human_inbox_messages WHERE thread_id = ?",
    ).get(threadId) as { count: number };
    const excess = count.count - MAX_HUMAN_MESSAGES_PER_THREAD;
    if (excess <= 0) return;
    const stale = database.prepare(
      `SELECT id FROM human_inbox_messages WHERE thread_id = ? AND (? IS NULL OR id != ?)
       ORDER BY CASE WHEN acknowledged_at IS NOT NULL AND bookmarked_at IS NULL THEN 0 WHEN acknowledged_at IS NULL AND bookmarked_at IS NULL THEN 1 ELSE 2 END,
         created_at ASC, id ASC LIMIT ?`,
    ).all(threadId, incomingId, incomingId, excess) as Array<{ id: string }>;
    const remove = database.prepare("DELETE FROM human_inbox_messages WHERE thread_id = ? AND id = ?");
    for (const row of stale) remove.run(threadId, row.id);
  };
  const transaction = <T>(work: () => T): T => database.transaction(work)();
  const assertLiveThread = async (threadId: string, projectId: string, generation: number) => {
    assertActive();
    const beforeLookup = lifecycleGuards.get(threadId);
    if (beforeLookup?.purgeFailed || (beforeLookup && beforeLookup.generation !== generation))
      throw new Error("Cannot write to a thread after its Inbox lifecycle closed.");
    const thread = await getThread(threadId);
    assertActive();
    const afterLookup = lifecycleGuards.get(threadId);
    if (afterLookup?.purgeFailed || (afterLookup && afterLookup.generation !== generation) || thread.id !== threadId || thread.projectId !== projectId || thread.archivedAt !== null)
      throw new Error("Cannot leave a Human Inbox message for an archived or unavailable thread.");
    return thread;
  };
  const assertWritableThread = (threadId: string) => {
    assertActive();
    const guard = lifecycleGuards.get(threadId);
    if (guard?.purgeFailed || (guard && guard.generation > 0))
      throw new Error("Cannot write to a thread after its Inbox lifecycle closed.");
  };
  const result = (message: HumanMessage, changed: boolean): InboxCreateResult => {
    Object.defineProperty(message, "changed", { value: changed, enumerable: false });
    return message as InboxCreateResult;
  };
  return {
    dispose() { disposed = true; lifecycleGuards.clear(); },
    async create(input: CreateInput): Promise<InboxCreateResult> {
      assertActive();
      const existingGuard = lifecycleGuards.get(input.threadId);
      if (existingGuard?.purgeFailed) throw new Error("Cannot write to a thread after its Inbox lifecycle closed.");
      if (input.idempotencyKey) {
        const existing = database.prepare("SELECT * FROM human_inbox_messages WHERE thread_id = ? AND idempotency_key = ?").get(input.threadId, input.idempotencyKey);
        if (existing) return result(messageFrom(existing as Record<string, unknown>), false);
      }
      const generation = existingGuard?.generation ?? 0;
      const inFlight = guardFor(input.threadId);
      inFlight.inFlightCreates += 1;
      try {
        await assertLiveThread(input.threadId, input.projectId, generation);
        assertActive();
        if (Buffer.byteLength(input.body.trim(), "utf8") > 32 * 1024)
          throw new Error("Human Inbox message body exceeds 32 KiB UTF-8.");
        return transaction(() => {
          const currentGuard = lifecycleGuards.get(input.threadId);
          if (currentGuard?.purgeFailed || (currentGuard && currentGuard.generation !== generation))
            throw new Error("Cannot write to a thread after its Inbox lifecycle closed.");
          if (input.idempotencyKey) {
            const existing = database.prepare("SELECT * FROM human_inbox_messages WHERE thread_id = ? AND idempotency_key = ?").get(input.threadId, input.idempotencyKey);
            if (existing) return result(messageFrom(existing as Record<string, unknown>), false);
          }
          const id = createId(); const time = now();
          database.prepare(
            `INSERT INTO human_inbox_messages (id, thread_id, project_id, subject, body, agent_thread_id, provider_id, agent_label, created_at, updated_at, acknowledged_at, bookmarked_at, revision, idempotency_key)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, 1, ?)`,
          ).run(
            id, input.threadId, input.projectId, normalizeSubject(input.subject), input.body.trim(),
            input.agentThreadId ?? null, input.providerId ?? null, normalizeAgentLabel(input.agentLabel),
            time, time, input.idempotencyKey ?? null,
          );
          retain(input.threadId, id);
          return result(messageFrom(requireOne(input.threadId, id)), true);
        });
      } finally {
        inFlight.inFlightCreates -= 1;
        releaseGuard(input.threadId, inFlight);
      }
    },
    get(threadId: string, messageId: string) { return messageFrom(requireOne(threadId, messageId)); },
    list({ threadId, query, limit, cursor }: { threadId: string; query?: string; limit: number; cursor?: string }) {
      const parsed = cursorFrom(cursor);
      if (cursor && !parsed) throw new Error("Invalid Human Inbox cursor.");
      const clauses = ["thread_id = ?"]; const values: unknown[] = [threadId];
      const normalizedQuery = query?.trim();
      if (normalizedQuery) {
        clauses.push("(id LIKE ? ESCAPE '\\' OR COALESCE(subject, '') LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\' OR COALESCE(agent_label, '') LIKE ? ESCAPE '\\')");
        values.push(...Array(4).fill(`%${escapeLike(normalizedQuery)}%`));
      } else clauses.push("(acknowledged_at IS NULL OR bookmarked_at IS NOT NULL)");
      if (parsed) { clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))"); values.push(parsed.updatedAt, parsed.updatedAt, parsed.id); }
      const rows = database.prepare(`SELECT * FROM human_inbox_messages WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...values, limit + 1) as Record<string, unknown>[];
      const messages: HumanMessage[] = [];
      const counts = database.prepare(
        `SELECT SUM(CASE WHEN acknowledged_at IS NULL THEN 1 ELSE 0 END) AS active,
          SUM(CASE WHEN acknowledged_at IS NOT NULL AND bookmarked_at IS NOT NULL THEN 1 ELSE 0 END) AS saved
         FROM human_inbox_messages WHERE thread_id = ?`,
      ).get(threadId) as { active: number | null; saved: number | null };
      const response = () => ({
        messages,
        cursor: rows.length > messages.length && messages.length ? cursorFor(messages.at(-1)!) : null,
        activeCount: counts.active ?? 0,
        savedCount: counts.saved ?? 0,
      });
      for (const row of rows.slice(0, limit)) {
        messages.push(messageFrom(row));
        // Include the cursor and counts in the exact returned JSON envelope.
        if (Buffer.byteLength(JSON.stringify(response()), "utf8") > 256 * 1024) {
          messages.pop();
          break;
        }
      }
      return response();
    },
    acknowledge(threadId: string, messageId: string, expectedRevision?: number) {
      return transaction(() => {
        assertWritableThread(threadId);
        const row = requireOne(threadId, messageId, expectedRevision);
        if (row.acknowledged_at !== null) return messageFrom(row);
        const time = now();
        database.prepare(
          "UPDATE human_inbox_messages SET acknowledged_at = ?, updated_at = ?, revision = revision + 1 WHERE thread_id = ? AND id = ?",
        ).run(time, time, threadId, messageId);
        return messageFrom(requireOne(threadId, messageId));
      });
    },
    bookmark(threadId: string, messageId: string, bookmarked: boolean, expectedRevision?: number) {
      return transaction(() => {
        assertWritableThread(threadId);
        const row = requireOne(threadId, messageId, expectedRevision);
        if ((row.bookmarked_at !== null) === bookmarked) return messageFrom(row);
        const time = now();
        database.prepare("UPDATE human_inbox_messages SET bookmarked_at = ?, updated_at = ?, revision = revision + 1 WHERE thread_id = ? AND id = ?").run(bookmarked ? time : null, time, threadId, messageId);
        return messageFrom(requireOne(threadId, messageId));
      });
    },
    update(threadId: string, messageId: string, changes: { subject?: string | null; body?: string; expectedRevision?: number }) {
      return transaction(() => {
        assertWritableThread(threadId);
        const row = requireOne(threadId, messageId, changes.expectedRevision);
        const subject = changes.subject === undefined ? row.subject : normalizeSubject(changes.subject);
        const body = changes.body === undefined ? String(row.body) : changes.body.trim();
        if (Buffer.byteLength(body, "utf8") > 32 * 1024)
          throw new Error("Human Inbox message body exceeds 32 KiB UTF-8.");
        if (subject === row.subject && body === row.body) return messageFrom(row);
        const time = now();
        database.prepare("UPDATE human_inbox_messages SET subject = ?, body = ?, updated_at = ?, acknowledged_at = NULL, revision = revision + 1 WHERE thread_id = ? AND id = ?").run(subject, body, time, threadId, messageId);
        return messageFrom(requireOne(threadId, messageId));
      });
    },
    purge(threadId: string) {
      const guard = guardFor(threadId);
      guard.generation += 1;
      try {
        database.prepare("DELETE FROM human_inbox_messages WHERE thread_id = ?").run(threadId);
        guard.purgeFailed = false;
        releaseGuard(threadId, guard);
      } catch (error) {
        guard.purgeFailed = true;
        throw error;
      }
    },
    lifecycleGuardCount() { return lifecycleGuards.size; },
    async reconcile({
      isActive = () => true,
      onCleanupError,
    }: {
      isActive?: () => boolean;
      onCleanupError?: (threadId: string) => void;
    } = {}) {
      try {
        if (disposed || !isActive()) return;
        const threads = database.prepare("SELECT DISTINCT thread_id FROM human_inbox_messages").all() as Array<{ thread_id: string }>;
        for (const { thread_id } of threads) {
          try {
            let thread: Thread | null;
            try {
              thread = await getThread(thread_id);
            } catch (error) {
              // SDK HTTP errors carry status/code. Never infer deletion from text
              // or from an unrelated missing host/resource.
              if (typeof error !== "object" || error === null
                || !("status" in error) || error.status !== 404
                || !("code" in error) || error.code !== "thread_not_found") throw error;
              thread = null;
            }
            if (disposed || !isActive()) return;
            if (thread === null || thread.archivedAt !== null) this.purge(thread_id);
            else transaction(() => retain(thread_id));
          } catch {
            if (!disposed && isActive()) onCleanupError?.(thread_id);
          }
        }
      } catch {
        // Startup reconciliation is best-effort and must never reject detached work.
      }
    },
  };
}
