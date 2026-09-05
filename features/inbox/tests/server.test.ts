import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { MAX_HUMAN_MESSAGES_PER_THREAD, createInboxService } from "../server.js";

const threadId = "thr_one";
const projectId = "proj_one";

function fixture() {
  const database = new Database(":memory:");
  database.exec(`CREATE TABLE human_inbox_messages (id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, project_id TEXT NOT NULL, subject TEXT, body TEXT NOT NULL, agent_thread_id TEXT, provider_id TEXT, agent_label TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, acknowledged_at TEXT, bookmarked_at TEXT, revision INTEGER NOT NULL, idempotency_key TEXT, UNIQUE(thread_id, idempotency_key))`);
  let tick = 0;
  const threads = new Map<string, { id: string; projectId: string; archivedAt: string | null }>([[threadId, { id: threadId, projectId, archivedAt: null }]]);
  const inbox = createInboxService({ database, now: () => `2026-09-06T00:00:${String(++tick).padStart(2, "0")}.000Z`, createId: () => `msg_${String(tick).padStart(4, "0")}`, getThread: async (id) => threads.get(id) ?? { id, projectId: "other", archivedAt: null } });
  const create = (body: string, extra: Record<string, unknown> = {}) => inbox.create({ threadId, projectId, body, ...extra });
  return { database, inbox, threads, create };
}

describe("Inbox server service", () => {
  it("creates stable idempotent records, enforces live ownership, and checks UTF-8 bytes", async () => {
    const { create, threads } = fixture();
    const first = await create("decision", { idempotencyKey: "retry" });
    await expect(create("changed", { idempotencyKey: "retry" })).resolves.toEqual(first);
    await expect(create("😀".repeat(9_000))).rejects.toThrow("32 KiB UTF-8");
    threads.set(threadId, { id: threadId, projectId, archivedAt: "2026-09-06T01:00:00.000Z" });
    await expect(create("late")).rejects.toThrow(/archived/);
  });

  it("protects thread scope and CAS, reopens edits, and makes ack/save no-ops idempotent", async () => {
    const { create, inbox } = fixture();
    const message = await create("body");
    expect(() => inbox.get("thr_other", message.id)).toThrow("not found");
    expect(() => inbox.update(threadId, message.id, { body: "new", expectedRevision: 2 })).toThrow("refresh and retry");
    const acknowledged = inbox.acknowledge(threadId, message.id, 1);
    expect(acknowledged.acknowledgedAt).toBe(acknowledged.updatedAt);
    expect(inbox.acknowledge(threadId, message.id, 2)).toEqual(acknowledged);
    const saved = inbox.bookmark(threadId, message.id, true, 2);
    expect(inbox.bookmark(threadId, message.id, true, 3)).toEqual(saved);
    expect(() => inbox.update(threadId, message.id, { body: "😀".repeat(9_000), expectedRevision: 3 })).toThrow("32 KiB UTF-8");
    expect(inbox.update(threadId, message.id, { body: "changed", expectedRevision: 3 })).toMatchObject({ acknowledgedAt: null, revision: 4 });
  });

  it("uses literal LIKE search and emits a cursor after output-bound pagination", async () => {
    const { create, inbox } = fixture();
    await create("100% _ markdown"); await create("plain");
    expect(inbox.list({ threadId, query: "% _", limit: 100 }).messages).toHaveLength(1);
    for (let index = 0; index < 10; index += 1) await create("x".repeat(32 * 1024));
    const page = inbox.list({ threadId, limit: 100 });
    expect(page.messages.length).toBeLessThan(12);
    expect(page.cursor).toEqual(expect.any(String));
    expect(inbox.list({ threadId, limit: 100, cursor: page.cursor! }).messages).not.toHaveLength(0);
  });

  it("keeps active and saved messages visible above newer acknowledged history while search includes history", async () => {
    const { create, inbox } = fixture();
    const active = await create("active message");
    const saved = await create("saved message");
    const acknowledged = inbox.acknowledge(threadId, saved.id, saved.revision);
    inbox.bookmark(threadId, saved.id, true, acknowledged.revision);
    for (let index = 0; index < 51; index += 1) {
      const history = await create(`history ${index}`);
      inbox.acknowledge(threadId, history.id, history.revision);
    }
    expect(inbox.list({ threadId, limit: 50 }).messages.map(({ id }) => id)).toEqual(
      expect.arrayContaining([active.id, saved.id]),
    );
    expect(inbox.list({ threadId, query: "history", limit: 100 }).messages).toHaveLength(51);
  });

  it.each([
    ["acknowledged", "2026-01-01T00:00:00.000Z", null],
    ["unacknowledged", null, null],
    ["bookmarked", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"],
  ])("evicts the oldest %s tier at record 501", async (_tier, acknowledgedAt, bookmarkedAt) => {
    const { database, inbox } = fixture();
    const insert = database.prepare("INSERT INTO human_inbox_messages VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, ?, ?, 1, NULL)");
    insert.run("msg_victim", threadId, projectId, "victim", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", acknowledgedAt, bookmarkedAt);
    for (let i = 0; i < MAX_HUMAN_MESSAGES_PER_THREAD; i += 1) insert.run(`seed_${i}`, threadId, projectId, "other", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z", "2026-02-01T00:00:00.000Z");
    await inbox.reconcile();
    expect(database.prepare("SELECT id FROM human_inbox_messages WHERE id = 'msg_victim'").get()).toBeUndefined();
  });

  it("hard-caps all-bookmarked records and purges lifecycle rows exactly", async () => {
    const { database, inbox } = fixture();
    const insert = database.prepare("INSERT INTO human_inbox_messages VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, NULL, ?, 1, NULL)");
    for (let i = 0; i <= MAX_HUMAN_MESSAGES_PER_THREAD; i += 1) insert.run(`seed_${i}`, threadId, projectId, "saved", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    await inbox.reconcile();
    expect(database.prepare("SELECT COUNT(*) AS count FROM human_inbox_messages").get()).toEqual({ count: 500 });
    database.prepare("INSERT INTO human_inbox_messages VALUES ('msg_other', 'thr_other', 'p', NULL, 'other', NULL, NULL, NULL, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', NULL, NULL, 1, NULL)").run();
    inbox.purge(threadId); inbox.purge(threadId);
    expect(database.prepare("SELECT thread_id FROM human_inbox_messages").all()).toEqual([{ thread_id: "thr_other" }]);
  });
});
