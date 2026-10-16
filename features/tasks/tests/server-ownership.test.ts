import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it, vi } from "vitest";
import { createTasksPluginAdapter, type Task } from "../server-task-adapter";
import { projectSidebarTask } from "../server-model";
import { projectTaskWorkflow } from "../workflow-model";

const PROJECT_ID = "01M110X2HHBYGSGJAB5ZBW382N";
const OTHER_PROJECT_ID = "01M110X2HHBYGSGJAB5ZBW382P";
const AGENT_ID = "01M1P000000000000000000001";
const HUMAN_ID = "01M1P000000000000000000002";
const DONE_ID = "01M1P000000000000000000003";
const CANCELED_ID = "01M1P000000000000000000004";
type WorkerState = "working" | "idle" | "completed" | "failed" | null;

function task(taskId: string, status: Task["status"], projectId = PROJECT_ID): Task {
  return {
    id: taskId, projectId, number: Number(taskId.at(-1)),
    key: `WORK-${taskId.at(-1)}`, title: `Task ${taskId.at(-1)}`,
    description: "", status, priority: "medium", dueDate: null,
    parentTaskId: null, position: Number(taskId.at(-1)),
    createdAt: "2026-10-16T00:00:00.000Z",
    updatedAt: "2026-10-16T00:00:00.000Z", labelIds: [],
  };
}

function fixture() {
  const nativeTasks = new Map([
    task(AGENT_ID, "in_progress"), task(HUMAN_ID, "in_review", OTHER_PROJECT_ID),
    task(DONE_ID, "done"), task(CANCELED_ID, "canceled"),
  ].map((record) => [record.id, record]));
  const state = {
    worker: "working" as WorkerState,
    omittedIds: new Set<string>(),
    failSecondPage: false,
    deletion: true as boolean | "error",
  };
  const callRpc = vi.fn(async ({ method, input }: {
    method: string;
    input?: unknown;
  }) => {
    const params = input as {
      activeOnly?: boolean; statuses?: Task["status"][]; taskId?: string; cursor?: string;
      threadId?: string; includeCompleted?: boolean; limit?: number;
    };
    if (method === "listTasks") {
      if (params.cursor) throw new Error("second page unavailable");
      const rows = [...nativeTasks.values()].filter((record) =>
        (!params.activeOnly || state.worker === "working") &&
        (!params.statuses || params.statuses.includes(record.status)) &&
        !state.omittedIds.has(record.id),
      );
      return state.failSecondPage
        ? { tasks: rows.slice(0, 1), nextCursor: "page-2" }
        : { tasks: rows, nextCursor: null };
    }
    if (method === "listProjects") return { projects: [PROJECT_ID, OTHER_PROJECT_ID].map((projectId) => ({
      id: projectId, name: projectId === PROJECT_ID ? "Work" : "Other",
      prefix: "WORK", nextTaskNumber: 5, color: "blue", folderId: null,
      linkedBbProjectId: null, createdAt: "2026-10-16T00:00:00.000Z",
    })) };
    if (method === "listTasksForThread") {
      const rows = state.worker && params.threadId === "thr_worker"
        ? [...nativeTasks.values()].filter((record) =>
          (!params.statuses || params.statuses.includes(record.status)) &&
          (params.includeCompleted || (record.status !== "done" && record.status !== "canceled")),
        ).slice(0, params.limit)
        : [];
      return { tasks: rows, taskThreads: rows.map((record) => ({
        id: "01M1P000000000000000000005", taskId: record.id,
        threadId: "thr_worker", presetName: "Attached", title: "Worker",
        liveStatus: state.worker, attachedAt: "2026-10-16T00:00:00.000Z",
        updatedAt: "2026-10-16T00:00:00.000Z",
      })) };
    }
    if (method === "listTaskThreads") return { taskThreads: state.worker ? [{
      id: "01M1P000000000000000000005", taskId: params.taskId,
      threadId: "thr_worker", presetName: "Attached", title: "Worker",
      liveStatus: state.worker, attachedAt: "2026-10-16T00:00:00.000Z",
      updatedAt: "2026-10-16T00:00:00.000Z",
    }] : [] };
    if (method === "deleteTask") {
      if (state.deletion === "error") throw new Error("delete failed");
      if (state.deletion) nativeTasks.delete(params.taskId!);
      return { deleted: state.deletion };
    }
    throw new Error(`Unexpected Tasks RPC: ${method}`);
  });
  const host = createFakePluginHost({ sdk: { plugins: { callRpc } } });
  const adapter = createTasksPluginAdapter(host.bb);
  const seed = async () => {
    await adapter.writeAssignee(AGENT_ID, "agent");
    await adapter.writeAssignee(HUMAN_ID, "human");
    await adapter.writeAssignee(DONE_ID, "agent");
    await adapter.writeAssignee(CANCELED_ID, "human");
  };
  return { adapter, state, callRpc, seed, nativeTasks, dispose: () => host.harness.lifecycle.dispose() };
}

describe("durable task ownership across sidebar reads", () => {
  it("keeps genuinely unassigned tasks Human without inferring or persisting an owner", async () => {
    const { adapter, dispose } = fixture();
    try {
      const result = await adapter.sidebar();
      expect(result.tasks.map((record) => record.assignee)).toEqual(["human", "human"]);
      expect(await adapter.readAssignees()).toEqual({});
    } finally { await dispose(); }
  });

  it.each(["idle", "completed", "failed", null] as const)(
    "retains Agent Queue, Human Needs You and completed history with worker %s",
    async (worker) => {
      const { adapter, state, callRpc, seed, dispose } = fixture();
      try {
        await seed();
        await adapter.sidebar();
        state.worker = worker;
        const result = await adapter.sidebar();
        const assignees = await adapter.readAssignees();
        expect.soft(assignees).toEqual({
          [AGENT_ID]: "agent", [HUMAN_ID]: "human",
          [DONE_ID]: "agent", [CANCELED_ID]: "human",
        });
        expect.soft(result.tasks.map((record) => record.id)).toEqual([
          AGENT_ID, HUMAN_ID,
        ]);
        expect.soft(result.tasks.find((record) => record.id === HUMAN_ID)).toMatchObject({
          projectId: OTHER_PROJECT_ID, projectName: "Other", assignee: "human",
        });
        const workflow = projectTaskWorkflow({
          outcomeTaskId: null,
          tasks: result.tasks,
          owners: worker ? [{
            taskId: AGENT_ID, threadId: "thr_worker", threadTitle: "Worker",
            providerId: "codex", liveStatus: worker,
          }] : [],
        });
        expect.soft(workflow.queue.map((item) => item.task.id)).toEqual([AGENT_ID]);
        expect.soft(workflow.needsYou.map((item) => item.task.id)).toEqual([HUMAN_ID]);
        expect.soft(workflow.completed).toEqual([]);
        // A separate full-history read must retain both terminal status and ownership.
        const history = [...(await adapter.allTasksById()).values()].map((record) =>
          projectSidebarTask(record, "Work", [], assignees[record.id]),
        );
        expect.soft(history.find((record) => record.id === DONE_ID)).toMatchObject({ status: "done", assignee: "agent" });
        // WorkOutcome reads the durable tasks even if the sidebar omitted them,
        // and defaults a missing assignment to Human through the same projection.
        const workOutcome = projectTaskWorkflow({
          outcomeTaskId: null, tasks: result.tasks, executionTasks: history, owners: [],
        });
        expect.soft(workOutcome.queue.map((item) => item.task.id)).toEqual([AGENT_ID]);
        expect.soft(workOutcome.needsYou.map((item) => item.task.id)).toEqual([HUMAN_ID]);
        expect(callRpc.mock.calls.filter(([request]) => request.method === "listTasks")[1]?.[0].input).toEqual({
          activeOnly: false,
          statuses: ["backlog", "todo", "in_progress", "in_review"],
          sort: "priority", limit: 500,
        });
      } finally { await dispose(); }
    },
  );

  it("reads at most five scoped terminal tasks and their links in one native RPC", async () => {
    const { adapter, state, callRpc, seed, dispose } = fixture();
    try {
      await seed();
      state.worker = "idle";
      const result = await adapter.sidebar("thr_worker");
      expect(result.tasks.map((record) => [record.id, record.assignee, record.linkedThreadIds])).toEqual([
        [DONE_ID, "agent", ["thr_worker"]], [CANCELED_ID, "human", ["thr_worker"]],
      ]);
      expect(callRpc.mock.calls.filter(([request]) => request.method === "listTasksForThread").map(([request]) => request.input)).toEqual([{
        threadId: "thr_worker", statuses: ["done", "canceled"], includeCompleted: true, limit: 5,
      }]);
      expect(callRpc.mock.calls.filter(([request]) => request.method === "listTaskThreads" || request.method === "listTasks")).toHaveLength(0);
      const other = await adapter.sidebar("thr_other");
      expect(other.tasks).toEqual([]);
      expect(await adapter.readAssignees()).toMatchObject({ [DONE_ID]: "agent", [CANCELED_ID]: "human" });
    } finally { await dispose(); }
  });

  it("requests only the bounded preview when a thread has more terminal tasks", async () => {
    const { adapter, state, nativeTasks, dispose } = fixture();
    try {
      for (const suffix of [6, 7, 8, 9]) {
        const record = task(`${AGENT_ID.slice(0, -1)}${suffix}`, "done");
        nativeTasks.set(record.id, record);
      }
      state.worker = "completed";
      expect((await adapter.sidebar("thr_worker")).tasks).toHaveLength(5);
    } finally { await dispose(); }
  });

  it("does not treat omissions or failed pagination as evidence to delete ownership", async () => {
    const { adapter, state, seed, dispose } = fixture();
    try {
      await seed();
      const original = await adapter.readAssignees();
      state.omittedIds.add(AGENT_ID);
      state.omittedIds.add(HUMAN_ID);
      await adapter.sidebar();
      expect.soft(await adapter.readAssignees()).toEqual(original);
      await seed();
      state.failSecondPage = true;
      await expect(adapter.sidebar()).rejects.toThrow("second page unavailable");
      expect(await adapter.readAssignees()).toEqual(original);
    } finally { await dispose(); }
  });

  it.each([false, "error", true] as const)(
    "cleans only the confirmed deleted task's assignment when delete returns %s",
    async (deletion) => {
      const { adapter, state, seed, dispose } = fixture();
      try {
        await seed();
        const original = await adapter.readAssignees();
        state.deletion = deletion;
        if (deletion === "error")
          await expect(adapter.deleteSidebar(AGENT_ID)).rejects.toThrow("delete failed");
        else
          await expect(adapter.deleteSidebar(AGENT_ID)).resolves.toEqual({ deleted: deletion });
        const expected = { ...original };
        if (deletion === true) delete expected[AGENT_ID];
        expect(await adapter.readAssignees()).toEqual(expected);
      } finally { await dispose(); }
    },
  );
});
