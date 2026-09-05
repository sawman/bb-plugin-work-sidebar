import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
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

  it("invalidates interleaved creates, releases successful lifecycle guards, and permits a later unarchive", async () => {
    let releaseLookup!: () => void;
    const lookup = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const { database } = fixture();
    const threads = new Map([[threadId, { id: threadId, projectId, archivedAt: null as string | null }]]);
    const inbox = createInboxService({
      database,
      getThread: async (id) => { await lookup; return threads.get(id)!; },
      createId: () => "msg_race",
    });
    const creating = inbox.create({ threadId, projectId, body: "late" });
    await Promise.resolve();
    inbox.purge(threadId);
    expect(inbox.lifecycleGuardCount()).toBe(1);
    releaseLookup();
    await expect(creating).rejects.toThrow(/archived|lifecycle/);
    expect(inbox.lifecycleGuardCount()).toBe(0);

    threads.set(threadId, { id: threadId, projectId, archivedAt: null });
    await expect(inbox.create({ threadId, projectId, body: "after unarchive" })).resolves.toMatchObject({ body: "after unarchive" });
    expect(inbox.lifecycleGuardCount()).toBe(0);

  });

  it("retains the generation through commit when purge follows a successful lookup", async () => {
    const { database } = fixture();
    const inbox = createInboxService({
      database, getThread: () => Promise.resolve({ id: threadId, projectId, archivedAt: null }),
    });
    const creating = inbox.create({ threadId, projectId, body: "must not reappear" });
    // assertLiveThread has accepted the live response; create has not resumed yet.
    await Promise.resolve();
    inbox.purge(threadId);
    await expect(creating).rejects.toThrow(/lifecycle/);
    expect(database.prepare("SELECT * FROM human_inbox_messages").all()).toEqual([]);
    expect(inbox.lifecycleGuardCount()).toBe(0);
    await expect(inbox.create({ threadId, projectId, body: "unarchived" })).resolves.toMatchObject({ body: "unarchived" });
  });

  it.each(["lookup pending", "lookup accepted"])("blocks disposed service creates with %s", async (stage) => {
    const { database } = fixture();
    let resolve!: (value: { id: string; projectId: string; archivedAt: null }) => void;
    const inbox = createInboxService({ database, getThread: () => new Promise((done) => { resolve = done; }) });
    const creating = inbox.create({ threadId, projectId, body: "late" });
    if (stage === "lookup accepted") {
      resolve({ id: threadId, projectId, archivedAt: null });
      await Promise.resolve();
    }
    inbox.dispose();
    const prepare = vi.spyOn(database, "prepare");
    if (stage === "lookup pending") resolve({ id: threadId, projectId, archivedAt: null });
    await expect(creating).rejects.toThrow(/disposed/);
    await expect(inbox.create({ threadId, projectId, body: "new after dispose", idempotencyKey: "retry" })).rejects.toThrow(/disposed/);
    expect(prepare).not.toHaveBeenCalled();
    prepare.mockRestore();
    expect(database.prepare("SELECT * FROM human_inbox_messages").all()).toEqual([]);
    expect(inbox.lifecycleGuardCount()).toBe(0);
  });

  it.each([false, true])("bounds the complete list JSON and preserves pagination (extra row: %s)", async (extraRow) => {
    const { create, inbox, database } = fixture();
    for (let i = 0; i < 8; i += 1) await create("x".repeat(32 * 1024));
    const rows = database.prepare("SELECT id FROM human_inbox_messages ORDER BY updated_at DESC, id DESC").all() as { id: string }[];
    const messages = rows.map(({ id }) => inbox.get(threadId, id));
    const excess = Buffer.byteLength(JSON.stringify({ messages }), "utf8") - 256 * 1024;
    // The messages-only envelope fits exactly; response metadata must force a split.
    database.prepare("UPDATE human_inbox_messages SET body = ? WHERE id = ?").run("x".repeat(32 * 1024 - excess), rows[0]!.id);
    if (extraRow) await create("older", { threadId: "thr_other", projectId: "other" });
    if (extraRow) database.prepare("UPDATE human_inbox_messages SET thread_id = ?, updated_at = '2020-01-01' WHERE thread_id = 'thr_other'").run(threadId);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = inbox.list({ threadId, limit: 100, cursor });
      expect(Buffer.byteLength(JSON.stringify(page), "utf8")).toBeLessThanOrEqual(256 * 1024);
      expect(page.activeCount).toBe(extraRow ? 9 : 8);
      expect(page.savedCount).toBe(0);
      expect(page.messages.length).toBeGreaterThan(0);
      seen.push(...page.messages.map(({ id }) => id));
      cursor = page.cursor ?? undefined;
    } while (cursor);
    expect(seen).toHaveLength(extraRow ? 9 : 8);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("allows synchronous mutations while an ordinary live create lookup is pending", async () => {
    let releaseLookup!: () => void;
    const lookup = new Promise<void>((resolve) => { releaseLookup = resolve; });
    const { database, create } = fixture();
    const existing = await create("existing");
    const inbox = createInboxService({
      database,
      createId: () => "msg_pending",
      getThread: async (id) => { await lookup; return { id, projectId, archivedAt: null }; },
    });
    const creating = inbox.create({ threadId, projectId, body: "pending" });
    await Promise.resolve();
    expect(inbox.acknowledge(threadId, existing.id, existing.revision)).toMatchObject({ acknowledgedAt: expect.any(String) });
    releaseLookup();
    await expect(creating).resolves.toMatchObject({ body: "pending" });
  });

  it("keeps a failed purge guard until a successful retry, without retaining successful tombstones", async () => {
    const { database, inbox, create } = fixture();
    const row = await create("before failure", { idempotencyKey: "before-failure" });
    database.exec(`CREATE TRIGGER fail_inbox_purge BEFORE DELETE ON human_inbox_messages
      WHEN OLD.thread_id = 'thr_one' BEGIN SELECT RAISE(FAIL, 'purge failed'); END`);
    expect(() => inbox.purge(threadId)).toThrow("purge failed");
    await expect(create("blocked after failure")).rejects.toThrow(/lifecycle/);
    await expect(create("idempotent retry after failure", { idempotencyKey: "before-failure" })).rejects.toThrow(/lifecycle/);
    expect(() => inbox.acknowledge(threadId, row.id, row.revision)).toThrow(/lifecycle/);
    expect(database.prepare("SELECT body FROM human_inbox_messages WHERE id = ?").get(row.id)).toEqual({ body: "before failure" });
    expect(inbox.lifecycleGuardCount()).toBe(1);

    database.exec("DROP TRIGGER fail_inbox_purge");
    inbox.purge(threadId);
    expect(inbox.lifecycleGuardCount()).toBe(0);
    await expect(create("fresh after cleanup")).resolves.toMatchObject({ body: "fresh after cleanup" });
    expect(inbox.lifecycleGuardCount()).toBe(0);
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

  it("retains an incoming create when all 500 existing records are bookmarked", async () => {
    const { database, inbox, create } = fixture();
    const insert = database.prepare("INSERT INTO human_inbox_messages VALUES (?, ?, ?, NULL, ?, NULL, NULL, NULL, ?, ?, NULL, ?, 1, NULL)");
    for (let i = 0; i < 500; i += 1) insert.run(`seed_${String(i).padStart(3, "0")}`, threadId, projectId, "saved", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    const incoming = await create("incoming", { idempotencyKey: "incoming-retry" });
    expect(inbox.get(threadId, incoming.id).body).toBe("incoming");
    expect(database.prepare("SELECT COUNT(*) AS count FROM human_inbox_messages").get()).toEqual({ count: 500 });
    expect(database.prepare("SELECT id FROM human_inbox_messages WHERE id = 'seed_000'").get()).toBeUndefined();
    expect(inbox.get(threadId, "seed_001").bookmarkedAt).not.toBeNull();
    await expect(create("retry", { idempotencyKey: "incoming-retry" })).resolves.toEqual(incoming);
  });

  it.each([
    ["missing", { status: 404, code: "thread_not_found" }, true],
    ["transient", { status: 503, code: "unavailable" }, false],
    ["ambiguous text", new Error("Thread not found during connection retry"), false],
    ["unrelated missing resource", { status: 404, code: "host_not_found" }, false],
  ])("reconciles %s lookup results without losing transient data", async (_label, error, purged) => {
    const { database, create } = fixture();
    const existing = await create("keep unless definitively deleted");
    let warnings = 0;
    const inbox = createInboxService({ database, getThread: async () => { throw error; } });
    await inbox.reconcile({ onCleanupError: () => { warnings += 1; } });
    expect(database.prepare("SELECT id FROM human_inbox_messages WHERE id = ?").get(existing.id))
      .toEqual(purged ? undefined : { id: existing.id });
    expect(warnings).toBe(purged ? 0 : 1);
  });

  it("retries a failed missing-thread purge and retains other threads", async () => {
    const { database, create } = fixture();
    const existing = await create("deleted thread");
    await create("live thread", { threadId: "thr_live", projectId: "other" });
    const inbox = createInboxService({ database, getThread: async (id) => {
      if (id === threadId) throw { status: 404, code: "thread_not_found" };
      return { id, projectId: "other", archivedAt: null };
    } });
    database.exec(`CREATE TRIGGER fail_missing_purge BEFORE DELETE ON human_inbox_messages
      WHEN OLD.thread_id = 'thr_one' BEGIN SELECT RAISE(FAIL, 'purge failed'); END`);
    const warnings: string[] = [];
    await inbox.reconcile({ onCleanupError: (id) => warnings.push(id) });
    expect(warnings).toEqual([threadId]);
    expect(inbox.get(threadId, existing.id).body).toBe("deleted thread");
    expect(inbox.lifecycleGuardCount()).toBe(1);
    database.exec("DROP TRIGGER fail_missing_purge");
    await inbox.reconcile();
    expect(inbox.lifecycleGuardCount()).toBe(0);
    expect(database.prepare("SELECT thread_id FROM human_inbox_messages").all()).toEqual([{ thread_id: "thr_live" }]);
  });

  it("does not purge a missing thread after reconciliation is disposed", async () => {
    const { database, create } = fixture();
    const existing = await create("keep after disposal");
    let rejectLookup!: (error: unknown) => void;
    const inbox = createInboxService({ database, getThread: () => new Promise((_resolve, reject) => { rejectLookup = reject; }) });
    let active = true;
    const reconcile = inbox.reconcile({ isActive: () => active });
    active = false;
    rejectLookup({ status: 404, code: "thread_not_found" });
    await reconcile;
    expect(inbox.get(threadId, existing.id).body).toBe("keep after disposal");
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
