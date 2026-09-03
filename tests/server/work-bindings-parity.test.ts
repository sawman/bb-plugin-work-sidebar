import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin, { createServerLifecycle } from "../../server";
import { WORK_BINDINGS_KEY } from "../../features/tasks/server-work-bindings";
import { TASK_ASSIGNEES_KEY } from "../../features/tasks/server-task-adapter";
import { WORK_ITEM_QUEUE_KEY } from "../../features/work-context/work-item-queue-server";
import { TRACKER_LINKS_KEY } from "../../features/tracker/server";

const TASK_PROJECT_ID = "01M12DCYYGDB0WT05RXEQ2K3XA";
const OUTCOME_TASK_ID = "01M12DCYZ0W87MD2SENEPDWMV8";
const DIRECT_TASK_ID = "01M12DCYZDXQZXZBXBNQAK09W0";
const DELEGATED_TASK_ID = "01M12DCYZS58C64J437VS4W3Z4";
const GENERIC_TASK_ID = "01M12DCYZQ8B7SWR5EHH90YD4Z";
const CREATED_OUTCOME_TASK_ID = "01M12E0M3R28T1ZWNBEKBCE017";
const CREATED_EXECUTION_TASK_ID = "01M12E0M3SA1XSVJ2YJH9674E9";
const TASK_LINK_ID = "01M12DDXXE4AS9ZHRJ7TCPWE10";
const ROOT_THREAD_ID = "thr_root";
const CHILD_THREAD_ID = "thr_child";
const BB_PROJECT_ID = "proj_root";

type FixtureTask = {
  id: string;
  projectId: string;
  number: number;
  key: string;
  title: string;
  description: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
  priority: "urgent" | "high" | "medium" | "low" | "none";
  dueDate: null;
  parentTaskId: string | null;
  position: number;
  createdAt: string;
  updatedAt: string;
  labelIds: string[];
};

function task(
  id: string,
  title: string,
  parentTaskId: string | null = null,
): FixtureTask {
  return {
    id,
    projectId: TASK_PROJECT_ID,
    number: 1,
    key: `WORK-${id.slice(-1)}`,
    title,
    description: "",
    status: "todo",
    priority: "medium",
    dueDate: null,
    parentTaskId,
    position: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    labelIds: [],
  };
}

function createBindingsFixture(options: {
  listTaskThreads?: (taskId: string) => Promise<unknown>;
  taskThreadsAttach?: (taskId: string, threadId: string) => Promise<unknown>;
  taskThreadsDetach?: (taskId: string, threadId: string) => Promise<unknown>;
  failRootResolution?: boolean;
  rootEnvironmentId?: string | null;
  spawn?: (input: unknown) => Promise<{ id: string }>;
} = {}) {
  const tasks = new Map([
    [OUTCOME_TASK_ID, task(OUTCOME_TASK_ID, "Durable outcome")],
    [DIRECT_TASK_ID, task(DIRECT_TASK_ID, "Direct execution", OUTCOME_TASK_ID)],
    [DELEGATED_TASK_ID, task(DELEGATED_TASK_ID, "Delegated execution", OUTCOME_TASK_ID)],
    [GENERIC_TASK_ID, task(GENERIC_TASK_ID, "Ordinary linked task")],
  ]);
  const createdTaskIds = [CREATED_OUTCOME_TASK_ID, CREATED_EXECUTION_TASK_ID];
  const taskThreads = new Map<string, Set<string>>();
  const spawnInputs: unknown[] = [];
  const dispatchEvents: string[] = [];
  const host = createFakePluginHost({
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => {
          if (options.failRootResolution)
            throw new Error("root lookup unavailable");
          return threadId === CHILD_THREAD_ID
            ? {
              id: CHILD_THREAD_ID,
              parentThreadId: ROOT_THREAD_ID,
              projectId: BB_PROJECT_ID,
              environmentId: options.rootEnvironmentId ?? null,
              title: "Child",
              titleFallback: null,
              status: "idle",
              runtime: { displayStatus: "idle" },
              providerId: "codex",
              archivedAt: null,
            }
            : {
              id: ROOT_THREAD_ID,
              parentThreadId: null,
              projectId: BB_PROJECT_ID,
              environmentId: options.rootEnvironmentId ?? null,
              title: "Root",
              titleFallback: null,
              status: "idle",
              runtime: { displayStatus: "idle" },
              providerId: "codex",
              archivedAt: null,
            };
        },
        list: async () => [],
        spawn: async (input: unknown) => {
          dispatchEvents.push("spawn");
          spawnInputs.push(input);
          return options.spawn?.(input) ?? { id: CHILD_THREAD_ID };
        },
        timeline: async () => ({ goal: null, pendingTodos: { items: [] } }),
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => ({
          id: environmentId,
          hostId: "host_root",
        }),
      },
      plugins: {
        callRpc: async ({ method, input }) => {
          const taskInput = input as Record<string, unknown> | undefined;
          if (method === "ping") return { ok: true, version: "test" };
          if (method === "listProjects") return {
            projects: [{
              id: TASK_PROJECT_ID,
              name: "Work",
              prefix: "WORK",
              nextTaskNumber: 5,
              color: "blue",
              folderId: null,
              linkedBbProjectId: BB_PROJECT_ID,
              createdAt: "2026-08-28T00:00:00.000Z",
            }],
          };
          if (method === "listTasks") return { tasks: [...tasks.values()], nextCursor: null };
          if (method === "updateTask") {
            const taskId = taskInput?.taskId as string;
            const updated = tasks.get(taskId);
            if (!updated) return { ok: false, error: { message: "Task not found" } };
            updated.status = taskInput?.status as FixtureTask["status"];
            return { ok: true, task: updated };
          }
          if (method === "createTask") {
            const taskId = createdTaskIds.shift();
            if (!taskId) throw new Error("No fixture task id remains");
            const created = task(
              taskId,
              taskInput?.title as string,
              (taskInput?.parentTaskId as string | null) ?? null,
            );
            created.description = taskInput?.description as string;
            created.status = taskInput?.status as FixtureTask["status"];
            created.priority = taskInput?.priority as FixtureTask["priority"];
            tasks.set(created.id, created);
            return { ok: true, task: created };
          }
          if (method === "listTaskThreads") {
            const taskId = taskInput?.taskId as string;
            if (options.listTaskThreads)
              return options.listTaskThreads(taskId);
            return {
              taskThreads: [...(taskThreads.get(taskId) ?? [])].map((threadId) => ({
                id: TASK_LINK_ID,
                taskId,
                threadId,
                presetName: "Attached",
                title: threadId === CHILD_THREAD_ID ? "Child" : "Root",
                liveStatus: "working",
                attachedAt: "2026-08-28T00:00:00.000Z",
                updatedAt: "2026-08-28T00:00:00.000Z",
              })),
            };
          }
          if (method === "taskThreadsAttach") {
            dispatchEvents.push("attach");
            const taskId = taskInput?.taskId as string;
            const threadId = taskInput?.threadId as string;
            if (options.taskThreadsAttach)
              return options.taskThreadsAttach(taskId, threadId);
            (taskThreads.get(taskId) ?? taskThreads.set(taskId, new Set()).get(taskId)!).add(threadId);
            return { threadId };
          }
          if (method === "taskThreadsDetach") {
            const taskId = taskInput?.taskId as string;
            const threadId = taskInput?.threadId as string;
            if (options.taskThreadsDetach)
              return options.taskThreadsDetach(taskId, threadId);
            taskThreads.get(taskId)?.delete(threadId);
            return { threadId };
          }
          throw new Error(`Unexpected Tasks RPC: ${method}`);
        },
      },
    },
  });
  return { dispatchEvents, host, spawnInputs, taskThreads, tasks };
}

async function createDelegatedExecution(
  host: ReturnType<typeof createBindingsFixture>["host"],
  idempotencyKey: string,
) {
  await host.harness.behavior.callAgentTool(
    "create_work_task",
    { title: "Durable outcome", description: "" },
    { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
  );
  await host.harness.behavior.callAgentTool(
    "create_execution_task",
    {
      title: "Delegated implementation",
      description: "",
      idempotencyKey,
      assignee: "agent",
    },
    { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
  );
}

describe("durable Work/Tasks binding parity", () => {
  it("migrates root records and task annotations out of shared KV documents", async () => {
    const { host } = createBindingsFixture();
    await host.bb.storage.kv.set(WORK_ITEM_QUEUE_KEY, {
      [ROOT_THREAD_ID]: {
        current: { source: "bb_task", id: OUTCOME_TASK_ID },
        backlog: [],
      },
    });
    await host.bb.storage.kv.set(TRACKER_LINKS_KEY, {
      [ROOT_THREAD_ID]: {
        keys: [{ projectId: BB_PROJECT_ID, locator: "issue-1", key: "LIN-1" }],
        primaryKey: "LIN-1",
      },
    });
    await host.bb.storage.kv.set(TASK_ASSIGNEES_KEY, {
      [OUTCOME_TASK_ID]: "agent",
    });
    await plugin(host.bb);

    await host.harness.behavior.callRpc("getWorkItemQueue", {
      threadId: ROOT_THREAD_ID,
    });
    await host.harness.behavior.callRpc("getWorkTracker", {
      threadId: ROOT_THREAD_ID,
    });
    host.bb.storage.database()
      .prepare(
        `INSERT INTO sidebar_task_assignee_state (task_id, assignee, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(CREATED_EXECUTION_TASK_ID, "human", "2026-09-04T00:00:00.000Z");
    await host.harness.behavior.callRpc("sidebarTasks", undefined);

    const database = host.bb.storage.database();
    expect(
      database
        .prepare<[string], { queue_json: string }>(
          "SELECT queue_json FROM work_item_queue_state WHERE root_thread_id = ?",
        )
        .get(ROOT_THREAD_ID),
    ).toMatchObject({ queue_json: expect.stringContaining(OUTCOME_TASK_ID) });
    expect(
      database
        .prepare<[string], { links_json: string }>(
          "SELECT links_json FROM tracker_link_state WHERE root_thread_id = ?",
        )
        .get(ROOT_THREAD_ID),
    ).toMatchObject({ links_json: expect.stringContaining("LIN-1") });
    expect(
      database
        .prepare<[string], { assignee: string }>(
          "SELECT assignee FROM sidebar_task_assignee_state WHERE task_id = ?",
        )
        .get(OUTCOME_TASK_ID),
    ).toEqual({ assignee: "agent" });
    await expect(host.bb.storage.kv.get(WORK_ITEM_QUEUE_KEY)).resolves.toBeUndefined();
    await expect(host.bb.storage.kv.get(TRACKER_LINKS_KEY)).resolves.toBeUndefined();
    await expect(host.bb.storage.kv.get(TASK_ASSIGNEES_KEY)).resolves.toBeUndefined();
    expect(
      database
        .prepare<[string], { assignee: string }>(
          "SELECT assignee FROM sidebar_task_assignee_state WHERE task_id = ?",
        )
        .get(CREATED_EXECUTION_TASK_ID),
    ).toBeUndefined();
  });

  it("migrates legacy bindings into SQLite and compacts terminal execution history there", async () => {
    const { host, tasks } = createBindingsFixture();
    const terminal = tasks.get(DELEGATED_TASK_ID)!;
    terminal.status = "done";
    const now = "2026-08-28T00:00:00.000Z";
    const execution = (idempotencyKey: string, dispatchState: "ready" | "recovery_required" = "ready") => ({
      kind: "execution" as const,
      rootThreadId: ROOT_THREAD_ID,
      outcomeTaskId: OUTCOME_TASK_ID,
      taskProjectId: TASK_PROJECT_ID,
      executionTaskId: DELEGATED_TASK_ID,
      ownerThreadId: CHILD_THREAD_ID,
      mode: "delegated" as const,
      idempotencyKey,
      dispatchState,
      recoveryMessage: dispatchState === "recovery_required" ? "Attachment needs recovery." : null,
      createdAt: now,
      updatedAt: now,
    });
    const outcome = {
      outcomes: [{
        kind: "outcome",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        createdAt: now,
        updatedAt: now,
      }],
      executions: [],
    };
    await host.bb.storage.kv.set(WORK_BINDINGS_KEY, outcome);
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("getWorkContext", {
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toMatchObject({
      bindings: [{ outcomeTaskId: OUTCOME_TASK_ID }],
    });

    await expect(host.bb.storage.kv.get(WORK_BINDINGS_KEY)).resolves.toBeUndefined();
    const database = host.bb.storage.database();
    database
      .prepare(
        `INSERT INTO work_binding_state (singleton, bindings_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           bindings_json = excluded.bindings_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        JSON.stringify({
          ...outcome,
          executions: [
            ...Array.from({ length: 700 }, (_, index) =>
              execution(`terminal-${index}`),
            ),
            {
              ...execution("active"),
              executionTaskId: DIRECT_TASK_ID,
              ownerThreadId: ROOT_THREAD_ID,
              mode: "direct" as const,
            },
            execution("recover", "recovery_required"),
          ],
        }),
        now,
      );

    await expect(
      host.harness.behavior.callRpc("getWorkContext", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({
      bindings: [
        { outcomeTaskId: OUTCOME_TASK_ID },
        { idempotencyKey: "active", executionTaskId: DIRECT_TASK_ID },
        { idempotencyKey: "recover", dispatchState: "recovery_required" },
      ],
    });
    expect(
      JSON.parse(
        database
          .prepare<[], { bindings_json: string }>(
            "SELECT bindings_json FROM work_binding_state WHERE singleton = 1",
          )
          .get()!.bindings_json,
      ),
    ).toMatchObject({
      executions: [
        { idempotencyKey: "active" },
        { idempotencyKey: "recover" },
      ],
    });
  });

  it("removes a completed ready execution from the sidecar while BB Tasks keeps the task", async () => {
    const { host, tasks } = createBindingsFixture();
    const now = "2026-08-28T00:00:00.000Z";
    await host.bb.storage.kv.set(WORK_BINDINGS_KEY, {
      outcomes: [{
        kind: "outcome",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        createdAt: now,
        updatedAt: now,
      }],
      executions: [{
        kind: "execution",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        executionTaskId: DIRECT_TASK_ID,
        ownerThreadId: ROOT_THREAD_ID,
        mode: "direct",
        idempotencyKey: "complete-and-prune",
        dispatchState: "ready",
        recoveryMessage: null,
        createdAt: now,
        updatedAt: now,
      }],
    });
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("updateTaskStatus", {
        taskId: DIRECT_TASK_ID,
        status: "done",
      }),
    ).resolves.toMatchObject({ task: { id: DIRECT_TASK_ID, status: "done" } });

    expect(tasks.get(DIRECT_TASK_ID)?.status).toBe("done");
    const row = host.bb.storage.database()
      .prepare<[], { bindings_json: string }>(
        "SELECT bindings_json FROM work_binding_state WHERE singleton = 1",
      )
      .get();
    expect(JSON.parse(row!.bindings_json)).toMatchObject({
      outcomes: [{ outcomeTaskId: OUTCOME_TASK_ID }],
      executions: [],
    });
  });

  it("bounds terminal outcome history while retaining the newest completed roots", async () => {
    const { host, tasks } = createBindingsFixture();
    tasks.get(OUTCOME_TASK_ID)!.status = "done";
    await plugin(host.bb);
    const database = host.bb.storage.database();
    const outcomes = Array.from({ length: 80 }, (_, index) => ({
      kind: "outcome" as const,
      rootThreadId:
        index === 79 ? ROOT_THREAD_ID : `thr_completed_${String(index).padStart(3, "0")}`,
      outcomeTaskId: OUTCOME_TASK_ID,
      taskProjectId: TASK_PROJECT_ID,
      createdAt: `2026-08-28T00:00:${String(index).padStart(2, "0")}.000Z`,
      updatedAt: `2026-08-28T00:00:${String(index).padStart(2, "0")}.000Z`,
    }));
    database
      .prepare(
        `INSERT INTO work_binding_state (singleton, bindings_json, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(singleton) DO UPDATE SET
           bindings_json = excluded.bindings_json,
           updated_at = excluded.updated_at`,
      )
      .run(JSON.stringify({ outcomes, executions: [] }), "2026-08-28T01:00:00.000Z");

    await host.harness.behavior.callRpc("getWorkContext", {
      threadId: ROOT_THREAD_ID,
    });

    const stored = JSON.parse(
      database
        .prepare<[], { bindings_json: string }>(
          "SELECT bindings_json FROM work_binding_state WHERE singleton = 1",
        )
        .get()!.bindings_json,
    );
    expect(stored.outcomes).toHaveLength(64);
    expect(stored.outcomes).toContainEqual(
      expect.objectContaining({ rootThreadId: ROOT_THREAD_ID }),
    );
  });

  it("resolves an ordinary link root before mutation so a lookup failure changes neither links nor cache", async () => {
    const { host, taskThreads, tasks } = createBindingsFixture({
      failRootResolution: true,
    });
    tasks.clear();
    tasks.set(GENERIC_TASK_ID, task(GENERIC_TASK_ID, "Ordinary legacy task"));
    const lifecycle = createServerLifecycle();
    await lifecycle.readLegacyWork(
      `${ROOT_THREAD_ID}\u0000${BB_PROJECT_ID}`,
      5_000,
      async () => ({ state: "none", taskIds: [], message: null }),
    );
    await plugin(host.bb, lifecycle);

    await expect(
      host.harness.behavior.callRpc("attachTaskToThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).rejects.toThrow("root lookup unavailable");
    expect(taskThreads.get(GENERIC_TASK_ID)).toBeUndefined();
    expect(lifecycle.legacyWorkCache.size).toBe(1);

    taskThreads.set(GENERIC_TASK_ID, new Set([ROOT_THREAD_ID]));
    await expect(
      host.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).rejects.toThrow("root lookup unavailable");
    expect(taskThreads.get(GENERIC_TASK_ID)).toEqual(new Set([ROOT_THREAD_ID]));
    expect(lifecycle.legacyWorkCache.size).toBe(1);
  });

  it("invalidates a warm legacy result immediately after ordinary attach and detach", async () => {
    const { host, taskThreads, tasks } = createBindingsFixture();
    tasks.clear();
    tasks.set(GENERIC_TASK_ID, task(GENERIC_TASK_ID, "Ordinary legacy task"));
    await plugin(host.bb, createServerLifecycle());

    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({ legacy: { state: "none" } });
    await expect(
      host.harness.behavior.callRpc("attachTaskToThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: ROOT_THREAD_ID });
    expect(taskThreads.get(GENERIC_TASK_ID)).toEqual(new Set([ROOT_THREAD_ID]));
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({ legacy: { state: "adoptable", taskIds: [GENERIC_TASK_ID] } });

    await expect(
      host.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: ROOT_THREAD_ID });
    expect(taskThreads.get(GENERIC_TASK_ID)).toEqual(new Set());
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({ legacy: { state: "none" } });
  });

  it("recomputes the complete legacy decision after a concurrent generic attach", async () => {
    let releaseStaleProbe!: (value: unknown) => void;
    let beginStaleProbe!: () => void;
    const staleProbeStarted = new Promise<void>((resolve) => {
      beginStaleProbe = resolve;
    });
    let discoveryCalls = 0;
    let links!: Map<string, Set<string>>;
    const { host, taskThreads, tasks } = createBindingsFixture({
      listTaskThreads: async (taskId) => {
        discoveryCalls += 1;
        if (discoveryCalls === 1) {
          beginStaleProbe();
          return new Promise((resolve) => {
            releaseStaleProbe = resolve;
          });
        }
        return {
          taskThreads: [...(links.get(taskId) ?? [])].map((threadId) => ({
            id: TASK_LINK_ID,
            taskId,
            threadId,
            presetName: "Attached",
            title: "Ordinary legacy task",
            liveStatus: "working",
            attachedAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          })),
        };
      },
    });
    links = taskThreads;
    tasks.clear();
    tasks.set(GENERIC_TASK_ID, task(GENERIC_TASK_ID, "Ordinary legacy task"));
    await plugin(host.bb, createServerLifecycle());

    const pendingOutcome = host.harness.behavior.callRpc("getWorkOutcome", {
      threadId: ROOT_THREAD_ID,
    });
    await staleProbeStarted;
    await expect(
      host.harness.behavior.callRpc("attachTaskToThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: ROOT_THREAD_ID });
    releaseStaleProbe({ taskThreads: [] });

    await expect(pendingOutcome).resolves.toMatchObject({
      legacy: { state: "adoptable", taskIds: [GENERIC_TASK_ID] },
    });
    expect(discoveryCalls).toBe(2);
  });

  it("publishes generic attach and detach only after success, never for failed or bound mutations", async () => {
    let releaseAttach!: (value: unknown) => void;
    let beginAttach!: () => void;
    const attachStarted = new Promise<void>((resolve) => { beginAttach = resolve; });
    const { host } = createBindingsFixture({
      taskThreadsAttach: async (_taskId, threadId) => {
        beginAttach();
        return new Promise((resolve) => { releaseAttach = resolve; }).then(() => ({ threadId }));
      },
    });
    await plugin(host.bb);
    const attach = host.harness.behavior.callRpc("attachTaskToThread", {
      taskId: GENERIC_TASK_ID,
      threadId: ROOT_THREAD_ID,
    });
    await attachStarted;
    expect(host.harness.inspection.realtimeSignals).toEqual([]);
    releaseAttach({});
    await expect(attach).resolves.toEqual({ threadId: ROOT_THREAD_ID });
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
    await expect(
      host.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: ROOT_THREAD_ID });
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);

    const { host: failed } = createBindingsFixture({
      taskThreadsAttach: async () => { throw new Error("attach unavailable"); },
      taskThreadsDetach: async () => { throw new Error("detach unavailable"); },
    });
    await plugin(failed.bb);
    await expect(
      failed.harness.behavior.callRpc("attachTaskToThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).rejects.toThrow("attach unavailable");
    await expect(
      failed.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).rejects.toThrow("detach unavailable");
    expect(failed.harness.inspection.realtimeSignals).toEqual([]);

    const { host: bound } = createBindingsFixture();
    await bound.bb.storage.kv.set(WORK_BINDINGS_KEY, {
      outcomes: [{
        kind: "outcome",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      }],
      executions: [],
    });
    await plugin(bound.bb);
    await expect(
      bound.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: OUTCOME_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).rejects.toThrow(
      "This task is part of a durable work binding and cannot be detached from its bound owner.",
    );
    expect(bound.harness.inspection.realtimeSignals).toEqual([]);
  });

  it("projects the bound owner thread title for left Tasks presentation", async () => {
    const { host, taskThreads } = createBindingsFixture();
    taskThreads.set(OUTCOME_TASK_ID, new Set([ROOT_THREAD_ID]));
    taskThreads.set(DIRECT_TASK_ID, new Set([ROOT_THREAD_ID]));
    taskThreads.set(DELEGATED_TASK_ID, new Set([CHILD_THREAD_ID]));
    await host.bb.storage.kv.set(WORK_BINDINGS_KEY, {
      outcomes: [{
        kind: "outcome",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      }],
      executions: [
        {
          kind: "execution",
          rootThreadId: ROOT_THREAD_ID,
          outcomeTaskId: OUTCOME_TASK_ID,
          taskProjectId: TASK_PROJECT_ID,
          executionTaskId: DIRECT_TASK_ID,
          ownerThreadId: ROOT_THREAD_ID,
          mode: "direct",
          idempotencyKey: "direct-title",
          dispatchState: "ready",
          recoveryMessage: null,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
        {
          kind: "execution",
          rootThreadId: ROOT_THREAD_ID,
          outcomeTaskId: OUTCOME_TASK_ID,
          taskProjectId: TASK_PROJECT_ID,
          executionTaskId: DELEGATED_TASK_ID,
          ownerThreadId: CHILD_THREAD_ID,
          mode: "delegated",
          idempotencyKey: "delegated-title",
          dispatchState: "ready",
          recoveryMessage: null,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    });
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("sidebarTaskLinks", null),
    ).resolves.toMatchObject({
      links: {
        [ROOT_THREAD_ID]: [
          { task: { id: OUTCOME_TASK_ID }, threadTitle: "Root", role: "outcome" },
          { task: { id: DIRECT_TASK_ID }, threadTitle: "Root", role: "execution" },
        ],
        [CHILD_THREAD_ID]: [
          { task: { id: DELEGATED_TASK_ID }, threadTitle: "Child", role: "execution" },
        ],
      },
    });
  });

  it("bounds parallel legacy discovery, caches it per root/project, expires it, and clears it after adoption", async () => {
    let open = false;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = () => { open = true; resolve(); }; });
    const calls: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const { host, tasks } = createBindingsFixture({
      listTaskThreads: async (taskId) => {
        calls.push(taskId);
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (!open) await gate;
        inFlight -= 1;
        return {
          taskThreads: taskId === OUTCOME_TASK_ID
            ? [{
              id: TASK_LINK_ID,
              taskId,
              threadId: ROOT_THREAD_ID,
              presetName: "Attached",
              title: "Recovered legacy outcome",
              liveStatus: "working",
              attachedAt: "2026-08-28T00:00:00.000Z",
              updatedAt: "2026-08-28T00:00:00.000Z",
            }]
            : [],
        };
      },
    });
    tasks.clear();
    for (const [id, title] of [
      [OUTCOME_TASK_ID, "Recovered legacy outcome"],
      [DIRECT_TASK_ID, "Other legacy candidate"],
      [DELEGATED_TASK_ID, "Another legacy candidate"],
    ] as const)
      tasks.set(id, task(id, title));
    const lifecycle = createServerLifecycle();
    await plugin(host.bb, lifecycle);

    const first = host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID });
    try {
      await vi.waitFor(() => expect(calls.length).toBeGreaterThan(1));
      expect(maxInFlight).toBeGreaterThan(1);
      expect(maxInFlight).toBeLessThanOrEqual(8);
    } finally {
      release();
      await first;
    }
    expect(calls).toHaveLength(3);

    await host.harness.behavior.callRpc("getWorkOutcome", { threadId: CHILD_THREAD_ID });
    expect(calls).toHaveLength(3);

    vi.useFakeTimers();
    try {
      await vi.advanceTimersByTimeAsync(5_001);
      await host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID });
    } finally {
      vi.useRealTimers();
    }
    expect(calls).toHaveLength(6);

    await host.harness.behavior.callRpc("adoptLegacyOutcome", {
      rootThreadId: ROOT_THREAD_ID,
      taskId: OUTCOME_TASK_ID,
    });
    expect(lifecycle.legacyWorkCache.size).toBe(0);
    expect(lifecycle.legacyWorkPending.size).toBe(0);
  });

  it("keeps legacy classifications distinct and clears a cached probe when a binding is created", async () => {
    const cases = [
      { name: "none", attached: [], expected: "none" },
      { name: "adoptable", attached: [OUTCOME_TASK_ID], expected: "adoptable" },
      { name: "ambiguous", attached: [OUTCOME_TASK_ID, DIRECT_TASK_ID], expected: "ambiguous" },
      { name: "project mismatch", attached: [DELEGATED_TASK_ID], expected: "project_mismatch" },
    ] as const;
    for (const testCase of cases) {
      const { host, taskThreads, tasks } = createBindingsFixture();
      tasks.clear();
      tasks.set(OUTCOME_TASK_ID, task(OUTCOME_TASK_ID, "First legacy task"));
      tasks.set(DIRECT_TASK_ID, task(DIRECT_TASK_ID, "Second legacy task"));
      tasks.set(DELEGATED_TASK_ID, {
        ...task(DELEGATED_TASK_ID, "Wrong-project legacy task"),
        projectId: "01M12E0M3R28T1ZWNBEKBCE017",
      });
      for (const taskId of testCase.attached)
        taskThreads.set(taskId, new Set([ROOT_THREAD_ID]));
      const lifecycle = createServerLifecycle();
      await plugin(host.bb, lifecycle);

      await expect(
        host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
      ).resolves.toMatchObject({ legacy: { state: testCase.expected } });
      expect(lifecycle.legacyWorkCache.size).toBe(1);
      await host.harness.behavior.callRpc("createWorkTask", {
        threadId: ROOT_THREAD_ID,
        title: `Bind after ${testCase.name}`,
        description: "",
        parentTaskId: null,
      });
      expect(lifecycle.legacyWorkCache.size).toBe(0);
    }
  });

  it("does not return a pending legacy adoption result after a durable outcome invalidates it", async () => {
    let release!: () => void;
    let started = false;
    const pending = new Promise<void>((resolve) => { release = resolve; });
    const { host, tasks } = createBindingsFixture({
      listTaskThreads: async (taskId) => {
        started = true;
        await pending;
        return {
          taskThreads: taskId === OUTCOME_TASK_ID
            ? [{
              id: TASK_LINK_ID,
              taskId,
              threadId: ROOT_THREAD_ID,
              presetName: "Attached",
              title: "Recovered legacy outcome",
              liveStatus: "working",
              attachedAt: "2026-08-28T00:00:00.000Z",
              updatedAt: "2026-08-28T00:00:00.000Z",
            }]
            : [],
        };
      },
    });
    tasks.clear();
    tasks.set(OUTCOME_TASK_ID, task(OUTCOME_TASK_ID, "Recovered legacy outcome"));
    await plugin(host.bb, createServerLifecycle());

    const staleRead = host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID });
    await vi.waitFor(() => expect(started).toBe(true));
    await host.harness.behavior.callRpc("createWorkTask", {
      threadId: ROOT_THREAD_ID,
      title: "Durable outcome",
      description: "",
      parentTaskId: null,
    });
    release();
    await expect(staleRead).resolves.toMatchObject({
      outcome: { title: "Durable outcome" },
      legacy: { state: "none", taskIds: [], message: null },
    });
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({ legacy: { state: "none" } });
  });

  it("rejects detaching outcome and execution targets from their bound owners while ordinary links remain mutable", async () => {
    const { host } = createBindingsFixture();
    const lifecycle = createServerLifecycle();
    await lifecycle.readLegacyWork(
      `${ROOT_THREAD_ID}\u0000${BB_PROJECT_ID}`,
      5_000,
      async () => ({ state: "none", taskIds: [], message: null }),
    );
    await host.bb.storage.kv.set(WORK_BINDINGS_KEY, {
      outcomes: [{
        kind: "outcome",
        rootThreadId: ROOT_THREAD_ID,
        outcomeTaskId: OUTCOME_TASK_ID,
        taskProjectId: TASK_PROJECT_ID,
        createdAt: "2026-08-28T00:00:00.000Z",
        updatedAt: "2026-08-28T00:00:00.000Z",
      }],
      executions: [
        {
          kind: "execution",
          rootThreadId: ROOT_THREAD_ID,
          outcomeTaskId: OUTCOME_TASK_ID,
          taskProjectId: TASK_PROJECT_ID,
          executionTaskId: DIRECT_TASK_ID,
          ownerThreadId: ROOT_THREAD_ID,
          mode: "direct",
          idempotencyKey: "direct",
          dispatchState: "ready",
          recoveryMessage: null,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
        {
          kind: "execution",
          rootThreadId: ROOT_THREAD_ID,
          outcomeTaskId: OUTCOME_TASK_ID,
          taskProjectId: TASK_PROJECT_ID,
          executionTaskId: DELEGATED_TASK_ID,
          ownerThreadId: CHILD_THREAD_ID,
          mode: "delegated",
          idempotencyKey: "delegated",
          dispatchState: "ready",
          recoveryMessage: null,
          createdAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        },
      ],
    });
    await plugin(host.bb, lifecycle);

    for (const [taskId, threadId] of [
      [OUTCOME_TASK_ID, ROOT_THREAD_ID],
      [DIRECT_TASK_ID, ROOT_THREAD_ID],
      [DELEGATED_TASK_ID, CHILD_THREAD_ID],
    ]) {
      await expect(
        host.harness.behavior.callRpc("detachTaskFromThread", { taskId, threadId }),
      ).rejects.toThrow(
        "This task is part of a durable work binding and cannot be detached from its bound owner.",
      );
    }
    expect(lifecycle.legacyWorkCache.size).toBe(1);

    await expect(
      host.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: OUTCOME_TASK_ID,
        threadId: CHILD_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: CHILD_THREAD_ID });
    await expect(
      host.harness.behavior.callRpc("detachTaskFromThread", {
        taskId: GENERIC_TASK_ID,
        threadId: ROOT_THREAD_ID,
      }),
    ).resolves.toEqual({ threadId: ROOT_THREAD_ID });
  });

  it("publishes ordered Work then Tasks signals only when agent tools create bindings", async () => {
    const { host } = createBindingsFixture();
    await plugin(host.bb);

    await host.harness.behavior.callAgentTool(
      "create_work_task",
      { title: "Create the durable outcome", description: "", assignee: "agent" },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);

    await host.harness.behavior.callAgentTool(
      "create_work_task",
      { title: "Reuse the durable outcome", description: "" },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );
    expect(host.harness.inspection.realtimeSignals).toHaveLength(2);
    expect(
      Object.fromEntries(
        host.bb.storage.database()
          .prepare<[], { task_id: string; assignee: "agent" | "human" }>(
            "SELECT task_id, assignee FROM sidebar_task_assignee_state",
          )
          .all()
          .map((row) => [row.task_id, row.assignee]),
      ),
    ).toMatchObject({ [CREATED_OUTCOME_TASK_ID]: "agent" });

    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      {
        title: "Create an execution task",
        description: "",
        idempotencyKey: "agent-created-execution",
        assignee: "human",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
    expect(
      Object.fromEntries(
        host.bb.storage.database()
          .prepare<[], { task_id: string; assignee: "agent" | "human" }>(
            "SELECT task_id, assignee FROM sidebar_task_assignee_state",
          )
          .all()
          .map((row) => [row.task_id, row.assignee]),
      ),
    ).toMatchObject({
      [CREATED_OUTCOME_TASK_ID]: "agent",
      [CREATED_EXECUTION_TASK_ID]: "human",
    });

    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      {
        title: "Reuse execution task",
        description: "",
        idempotencyKey: "agent-created-execution",
        assignee: "human",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );
    expect(host.harness.inspection.realtimeSignals).toHaveLength(4);
  });

  it("publishes one root-scoped Work signal while Tasks remains root-scoped once", async () => {
    const { host } = createBindingsFixture();
    await plugin(host.bb);
    await host.harness.behavior.callAgentTool(
      "create_work_task",
      { title: "Create the durable outcome", description: "" },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );
    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      {
        title: "Create delegated execution",
        description: "",
        idempotencyKey: "delegated-owner",
        assignee: "agent",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );

    await host.harness.behavior.callAgentTool(
      "bind_execution_owner",
      {
        idempotencyKey: "delegated-owner",
        mode: "delegated",
        prompt: "Complete the bounded task.",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );

    expect(host.harness.inspection.realtimeSignals.slice(-2)).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
  });

  it("spawns delegated code edits in a managed worktree under the durable root before attaching the child", async () => {
    const { dispatchEvents, host, spawnInputs, taskThreads } = createBindingsFixture({
      rootEnvironmentId: "env_root",
    });
    await plugin(host.bb);
    await createDelegatedExecution(host, "managed-code-edit");
    dispatchEvents.length = 0;

    await host.harness.behavior.callAgentTool(
      "bind_execution_owner",
      {
        idempotencyKey: "managed-code-edit",
        mode: "delegated",
        environment: "managed-worktree",
        baseBranch: "main",
        prompt: "Implement the isolated code change.",
        title: "Managed code edit",
        visibility: "hidden",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );

    expect(spawnInputs).toEqual([{
      projectId: BB_PROJECT_ID,
      parentThreadId: ROOT_THREAD_ID,
      environment: {
        type: "host",
        hostId: "host_root",
        workspace: {
          type: "managed-worktree",
          baseBranch: { kind: "named", name: "main" },
        },
      },
      prompt: "Implement the isolated code change.",
      title: "Managed code edit",
      visibility: "hidden",
      origin: "plugin",
      originPluginId: "test-plugin",
    }]);
    expect(dispatchEvents).toEqual(["spawn", "attach"]);
    expect(taskThreads.get(CREATED_EXECUTION_TASK_ID)).toEqual(
      new Set([CHILD_THREAD_ID]),
    );
  });

  it("reuses the root environment only when delegated work explicitly requests reuse", async () => {
    const { dispatchEvents, host, spawnInputs, taskThreads } = createBindingsFixture({
      rootEnvironmentId: "env_root",
    });
    await plugin(host.bb);
    await createDelegatedExecution(host, "explicit-reuse");
    dispatchEvents.length = 0;

    await host.harness.behavior.callAgentTool(
      "bind_execution_owner",
      {
        idempotencyKey: "explicit-reuse",
        mode: "delegated",
        environment: "reuse",
        prompt: "Inspect the existing checkout.",
      },
      { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
    );

    expect(spawnInputs).toEqual([expect.objectContaining({
      projectId: BB_PROJECT_ID,
      parentThreadId: ROOT_THREAD_ID,
      environment: { type: "reuse", environmentId: "env_root" },
    })]);
    expect(dispatchEvents).toEqual(["spawn", "attach"]);
    expect(taskThreads.get(CREATED_EXECUTION_TASK_ID)).toEqual(
      new Set([CHILD_THREAD_ID]),
    );
  });

  it("rejects invalid delegated environment selections before it can spawn or attach a child", async () => {
    const { host, spawnInputs, taskThreads } = createBindingsFixture({
      rootEnvironmentId: "env_root",
    });
    await plugin(host.bb);
    await createDelegatedExecution(host, "invalid-environment");

    await expect(
      host.harness.behavior.callAgentTool(
        "bind_execution_owner",
        {
          idempotencyKey: "invalid-environment",
          mode: "delegated",
          environment: "reuse",
          baseBranch: "main",
          prompt: "This must not spawn.",
        },
        { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
      ),
    ).rejects.toThrow("baseBranch requires environment managed-worktree");
    expect(spawnInputs).toEqual([]);
    expect(taskThreads.get(CREATED_EXECUTION_TASK_ID)).toBeUndefined();
  });

  it("requires a root environment before a managed-worktree delegation can become pending", async () => {
    const { host, spawnInputs, taskThreads } = createBindingsFixture();
    await plugin(host.bb);
    await createDelegatedExecution(host, "missing-managed-root");

    await expect(
      host.harness.behavior.callAgentTool(
        "bind_execution_owner",
        {
          idempotencyKey: "missing-managed-root",
          mode: "delegated",
          environment: "managed-worktree",
          prompt: "This must not become a recovery case.",
        },
        { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
      ),
    ).rejects.toThrow("Managed-worktree delegation requires the root thread environment");
    expect(spawnInputs).toEqual([]);
    expect(taskThreads.get(CREATED_EXECUTION_TASK_ID)).toBeUndefined();
    await expect(
      host.harness.behavior.callAgentTool(
        "bind_execution_owner",
        { idempotencyKey: "missing-managed-root", mode: "delegated", prompt: "Retry safely." },
        { threadId: ROOT_THREAD_ID, projectId: BB_PROJECT_ID },
      ),
    ).resolves.toBeDefined();
    expect(spawnInputs).toEqual([expect.objectContaining({
      parentThreadId: ROOT_THREAD_ID,
      environment: { type: "project-default" },
    })]);
  });

  it("reads and safely adopts the one legacy outcome candidate through the typed Work surface", async () => {
    const { host, taskThreads, tasks } = createBindingsFixture();
    tasks.clear();
    tasks.set(OUTCOME_TASK_ID, task(OUTCOME_TASK_ID, "Recovered legacy outcome"));
    taskThreads.set(OUTCOME_TASK_ID, new Set([ROOT_THREAD_ID]));
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("getWorkContext", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({
      legacy: {
        state: "adoptable",
        taskIds: [OUTCOME_TASK_ID],
        message: "One legacy top-level attachment can be explicitly adopted.",
      },
    });
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({
      legacy: {
        state: "adoptable",
        taskIds: [OUTCOME_TASK_ID],
      },
    });

    await expect(
      host.harness.behavior.callRpc("adoptLegacyOutcome", {
        rootThreadId: ROOT_THREAD_ID,
        taskId: OUTCOME_TASK_ID,
      }),
    ).resolves.toMatchObject({ task: { id: OUTCOME_TASK_ID } });
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: ROOT_THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: ROOT_THREAD_ID } },
    ]);
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: ROOT_THREAD_ID }),
    ).resolves.toMatchObject({
      outcome: { id: OUTCOME_TASK_ID },
      legacy: { state: "none", taskIds: [], message: null },
    });
  });

  it("persists an optional outcome priority exactly once and never remaps a reused outcome", async () => {
    const { host } = createBindingsFixture();
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("createWorkTask", {
        threadId: ROOT_THREAD_ID,
        title: "Create from Linear",
        description: "",
        parentTaskId: null,
        priority: "urgent",
      }),
    ).resolves.toMatchObject({ task: { priority: "urgent" } });

    await expect(
      host.harness.behavior.callRpc("createWorkTask", {
        threadId: ROOT_THREAD_ID,
        title: "Later Linear edit",
        description: "",
        parentTaskId: null,
        priority: "low",
      }),
    ).resolves.toMatchObject({ task: { priority: "urgent" } });
  });
});
