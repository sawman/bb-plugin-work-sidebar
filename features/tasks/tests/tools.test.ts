import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server";
import { WORK_AGENT_INSTRUCTIONS } from "../server-service";

const TASK_ID = "01M13DFQ4H0THGGYX5MNR52QKB";
const PROJECT_ID = "01M110X2HHBYGSGJAB5ZBW382N";
const COMMENT_ID = "01M13E0N7JP9M4K5DVEW8G3QZT";
const THREAD_ID = "thr_tools";
const CREATED_OUTCOME_TASK_ID = "01M13DFQ4H0THGGYX5MNR52QKC";
const CREATED_AGENT_TASK_ID = "01M13DFQ4H0THGGYX5MNR52QKD";
const CREATED_HUMAN_TASK_ID = "01M13DFQ4H0THGGYX5MNR52QKE";

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

function task(): FixtureTask {
  return {
    id: TASK_ID,
    projectId: PROJECT_ID,
    number: 60,
    key: "BBPLUG-60",
    title: "Broaden agent Tasks workflow tools",
    description: "Initial description",
    status: "in_progress" as const,
    priority: "medium" as const,
    dueDate: null,
    parentTaskId: null,
    position: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    updatedAt: "2026-08-28T00:00:00.000Z",
    labelIds: [],
  };
}

function fixture(options: {
  taskThreadsAttach?: (taskId: string, threadId: string) => Promise<unknown>;
} = {}) {
  let current = task();
  const tasks = new Map([[current.id, current]]);
  const createdTaskIds = [
    CREATED_OUTCOME_TASK_ID,
    CREATED_AGENT_TASK_ID,
    CREATED_HUMAN_TASK_ID,
  ];
  const taskThreads = new Map([[TASK_ID, new Set([THREAD_ID])]]);
  const callRpc = vi.fn(async ({ method, input }: { method: string; input?: unknown }) => {
    const value = input as Record<string, unknown> | null;
    if (method === "ping") return { ok: true, version: "test" };
    if (method === "getTaskByKey")
      return { task: [...tasks.values()].find((candidate) => candidate.key === value?.taskKey) ?? null };
    if (method === "listProjects")
      return {
        projects: [
          {
            id: PROJECT_ID,
            name: "bbplug",
            prefix: "BBPLUG",
            nextTaskNumber: 61,
            color: "blue",
            folderId: null,
            linkedBbProjectId: "proj_root",
            createdAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      };
    if (method === "listComments")
      return {
        comments: [
          {
            id: COMMENT_ID,
            taskId: TASK_ID,
            kind: "agent",
            authorName: "Agent",
            presetName: null,
            threadId: THREAD_ID,
            body: "Existing milestone",
            notifiedCount: 0,
            createdAt: "2026-08-28T00:01:00.000Z",
            threadTitle: "Task tools",
            provider: { id: "codex", name: "Codex", logoUrl: null },
          },
        ],
      };
    if (method === "listTaskThreads")
      return {
        taskThreads: [...(taskThreads.get(value?.taskId as string) ?? [])].map((threadId) => ({
          id: "01M13E1M4MKM1QYN8C0P4A2R7F",
          taskId: value?.taskId,
          threadId,
          presetName: "Direct",
          title: "Task tools",
          liveStatus: "working",
          attachedAt: "2026-08-28T00:00:00.000Z",
          updatedAt: "2026-08-28T00:00:00.000Z",
        })),
      };
    if (method === "listTasks") return { tasks: [...tasks.values()], nextCursor: null };
    if (method === "createTask") {
      const id = createdTaskIds.shift();
      if (!id) throw new Error("No fixture task id remains");
      const created = {
        ...task(),
        id,
        key: `BBPLUG-${60 + tasks.size}`,
        title: value?.title as string,
        description: value?.description as string,
        status: value?.status as typeof current.status,
        priority: value?.priority as typeof current.priority,
        parentTaskId: value?.parentTaskId as string | null,
      };
      tasks.set(id, created);
      return { ok: true, task: created };
    }
    if (method === "taskThreadsAttach") {
      const taskId = value?.taskId as string;
      const threadId = value?.threadId as string;
      if (options.taskThreadsAttach)
        return options.taskThreadsAttach(taskId, threadId);
      (taskThreads.get(taskId) ?? taskThreads.set(taskId, new Set()).get(taskId)!).add(threadId);
      return { threadId };
    }
    if (method === "updateTask") {
      const { taskId, authorName: _authorName, ...changes } = value ?? {};
      const existing = tasks.get(taskId as string);
      if (!existing) return { ok: false, error: { code: "not_found", message: "Task not found" } };
      const updated = { ...existing, ...changes };
      tasks.set(updated.id, updated);
      if (updated.id === current.id) current = updated;
      return { ok: true, task: updated };
    }
    if (method === "createComment")
      return {
        comment: {
          id: COMMENT_ID,
          taskId: TASK_ID,
          kind: "user",
          authorName: "You",
          presetName: null,
          threadId: null,
          body: value?.body,
          notifiedCount: 0,
          createdAt: "2026-08-28T00:02:00.000Z",
        },
      };
    throw new Error(`Unexpected Tasks RPC: ${method}`);
  });
  const host = createFakePluginHost({
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({
          id: threadId,
          parentThreadId: null,
          projectId: "proj_root",
          environmentId: null,
          title: "Task tools",
          titleFallback: null,
          status: "idle",
          runtime: { displayStatus: "idle" },
          providerId: "codex",
          archivedAt: null,
        }),
        list: async () => [],
        spawn: async () => ({ id: "thr_child" }),
        timeline: async () => ({ goal: null, pendingTodos: { items: [] } }),
      },
      plugins: { callRpc },
    },
  });
  return { host, callRpc, tasks, taskThreads };
}

function toolText(output: unknown) {
  if (typeof output === "string") return output;
  if (
    output &&
    typeof output === "object" &&
    "content" in output &&
    Array.isArray(output.content)
  ) {
    const text = output.content.find(
      (part): part is { type: "text"; text: string } =>
        Boolean(part) &&
        typeof part === "object" &&
        "type" in part &&
        part.type === "text" &&
        "text" in part &&
        typeof part.text === "string",
    );
    if (text) return text.text;
  }
  throw new Error("Agent tool did not return text output.");
}

describe("agent-facing Tasks workflow tools", () => {
  it("does not park validated tasks in review without a real gate", () => {
    expect(WORK_AGENT_INSTRUCTIONS).toContain(
      "Move fully validated tasks directly from in_progress to done",
    );
    expect(WORK_AGENT_INSTRUCTIONS).toContain(
      "use in_review only while a named reviewer or concrete acceptance gate is actually pending",
    );
    expect(WORK_AGENT_INSTRUCTIONS).toContain(
      "Set assignee to Agent when creating work for yourself",
    );
  });

  it("registers exactly the configured workflow tool surface and dynamic instructions", async () => {
    const { host } = fixture();
    await plugin(host.bb);

    expect(host.harness.inspection.registrations.agentTools.map((tool) => tool.name)).toEqual([
      "create_work_task",
      "get_task",
      "update_task",
      "comment_task",
      "get_work_context",
      "create_execution_task",
      "bind_execution_owner",
      "get_sidebar_tasks",
    ]);
    expect(host.harness.inspection.registrations.agentConfigurationProvider?.({
      thread: { id: THREAD_ID, title: "Task tools", parentThreadId: null, sourceThreadId: null },
      project: { id: "proj_root", kind: "standard", name: "bbplug", gitRemoteUrl: null },
      environment: { id: "env_test", name: null, path: null, workspaceProvisionType: "managed-worktree", branchName: null },
      host: { id: "host_test", name: "Test" },
      provider: { id: "codex", model: "gpt-5.6", capabilities: { supportsNativeUserQuestion: false } },
      origin: { kind: null, pluginId: null },
    }).tools).toEqual([
      "get_sidebar_tasks",
      "get_task",
      "update_task",
      "comment_task",
      "get_work_context",
      "create_work_task",
      "create_execution_task",
      "bind_execution_owner",
    ]);
    expect(WORK_AGENT_INSTRUCTIONS).toContain("Pending/recovery dispatch states require explicit reconciliation");
    expect(WORK_AGENT_INSTRUCTIONS).toContain("Builtin Tasks 0.1.2 cannot preserve root parenting");
    expect(WORK_AGENT_INSTRUCTIONS).toContain("bb thread spawn --parent-self --new-environment worktree");
    expect(WORK_AGENT_INSTRUCTIONS).toContain("environment managed-worktree");
  });

  it("reads one task with project, assignment, comments, and worker threads", async () => {
    const { host } = fixture();
    await plugin(host.bb);

    const output = await host.harness.behavior.callAgentTool(
      "get_task",
      { key: "BBPLUG-60" },
      { threadId: THREAD_ID, projectId: "proj_root" },
    );

    expect(JSON.parse(toolText(output))).toMatchObject({
      task: { key: "BBPLUG-60", projectName: "bbplug", assignee: "human" },
      comments: [{ body: "Existing milestone", provider: { name: "Codex" } }],
      threads: [{ threadId: THREAD_ID, liveStatus: "working" }],
    });
  });

  it("updates safe task fields and assignment, then publishes root Work and Tasks invalidations", async () => {
    const { host, callRpc } = fixture();
    await plugin(host.bb);

    const output = await host.harness.behavior.callAgentTool(
      "update_task",
      {
        key: "BBPLUG-60",
        status: "done",
        priority: "high",
        assignee: "human",
      },
      { threadId: THREAD_ID, projectId: "proj_root" },
    );

    expect(JSON.parse(toolText(output))).toMatchObject({
      task: { key: "BBPLUG-60", status: "done", priority: "high", assignee: "human" },
    });
    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "updateTask",
        input: {
          taskId: TASK_ID,
          status: "done",
          priority: "high",
          authorName: "Work Sidebar Agent",
        },
      }),
    );
    expect(host.harness.inspection.realtimeSignals).toEqual([
      {
        channel: "work-sidebar:changed",
        payload: { family: "work", rootThreadId: THREAD_ID },
      },
      {
        channel: "work-sidebar:changed",
        payload: { family: "tasks", threadId: THREAD_ID },
      },
    ]);
  });

  it("adds a milestone comment through the Tasks RPC and rejects empty updates", async () => {
    const { host, callRpc } = fixture();
    await plugin(host.bb);

    const output = await host.harness.behavior.callAgentTool(
      "comment_task",
      { key: "BBPLUG-60", body: "Focused validation is green.", notify: false },
      { threadId: THREAD_ID, projectId: "proj_root" },
    );
    expect(JSON.parse(toolText(output))).toMatchObject({
      taskKey: "BBPLUG-60",
      comment: { id: COMMENT_ID, body: "Focused validation is green." },
    });
    expect(callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "createComment",
        input: { taskId: TASK_ID, body: "Focused validation is green.", notify: false },
      }),
    );
    await expect(
      host.harness.behavior.callAgentTool(
        "update_task",
        { key: "BBPLUG-60" },
        { threadId: THREAD_ID, projectId: "proj_root" },
      ),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callAgentTool(
        "create_execution_task",
        {
          title: "Invalid owner",
          idempotencyKey: "invalid-owner",
          assignee: "robot",
        } as never,
        { threadId: THREAD_ID, projectId: "proj_root" },
      ),
    ).rejects.toThrow();
    await expect(
      host.harness.behavior.callAgentTool(
        "bind_execution_owner",
        { idempotencyKey: "anything", mode: "direct", leaked: true } as never,
        { threadId: THREAD_ID, projectId: "proj_root" },
      ),
    ).rejects.toThrow();
  });

  it("runs the complete durable task journey with exact ordered invalidations", async () => {
    const { host, tasks, taskThreads } = fixture();
    await plugin(host.bb);
    const context = { threadId: THREAD_ID, projectId: "proj_root" };

    await host.harness.behavior.callAgentTool(
      "create_work_task",
      { title: "Outcome", description: "Durable work", assignee: "agent" },
      context,
    );
    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      { title: "Agent implementation", description: "Implement it", idempotencyKey: "agent-self", assignee: "agent" },
      context,
    );
    await host.harness.behavior.callAgentTool(
      "bind_execution_owner",
      { idempotencyKey: "agent-self", mode: "direct" },
      context,
    );
    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      { title: "Human decision", description: "Choose the policy", idempotencyKey: "human-decision", assignee: "human" },
      context,
    );
    await expect(
      host.harness.behavior.callRpc("getWorkOutcome", { threadId: THREAD_ID }),
    ).resolves.toMatchObject({
      executionTasks: [
        expect.objectContaining({ key: "BBPLUG-62", assignee: "agent" }),
        expect.objectContaining({ key: "BBPLUG-63", assignee: "human" }),
      ],
    });
    const details = await host.harness.behavior.callAgentTool(
      "get_task",
      { key: "BBPLUG-63" },
      context,
    );
    expect(JSON.parse(toolText(details))).toMatchObject({
      task: { key: "BBPLUG-63", assignee: "human", parentTaskId: CREATED_OUTCOME_TASK_ID },
    });
    await host.harness.behavior.callAgentTool(
      "comment_task",
      { key: "BBPLUG-63", body: "Decision is ready.", notify: false },
      context,
    );
    await host.harness.behavior.callAgentTool(
      "update_task",
      { key: "BBPLUG-63", status: "done", assignee: "human" },
      context,
    );

    expect(tasks.get(CREATED_AGENT_TASK_ID)).toMatchObject({ parentTaskId: CREATED_OUTCOME_TASK_ID });
    expect(tasks.get(CREATED_HUMAN_TASK_ID)).toMatchObject({ parentTaskId: CREATED_OUTCOME_TASK_ID, status: "done" });
    expect(taskThreads.get(CREATED_AGENT_TASK_ID)).toEqual(new Set([THREAD_ID]));
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
    ]);
  });

  it("records attachment recovery and refuses an automatic retry", async () => {
    let attachmentCalls = 0;
    const { host } = fixture({
      taskThreadsAttach: async (_taskId, threadId) => {
        attachmentCalls += 1;
        if (attachmentCalls === 1) return { threadId };
        throw new Error("Tasks attachment unavailable");
      },
    });
    await plugin(host.bb);
    const context = { threadId: THREAD_ID, projectId: "proj_root" };

    await host.harness.behavior.callAgentTool(
      "create_work_task",
      { title: "Outcome", description: "Durable work", assignee: "agent" },
      context,
    );
    await host.harness.behavior.callAgentTool(
      "create_execution_task",
      { title: "Agent implementation", description: "Implement it", idempotencyKey: "recovery", assignee: "agent" },
      context,
    );
    const first = await host.harness.behavior.callAgentTool(
      "bind_execution_owner",
      { idempotencyKey: "recovery", mode: "direct" },
      context,
    );
    expect(JSON.parse(toolText(first))).toMatchObject({
      binding: { dispatchState: "recovery_required", ownerThreadId: THREAD_ID },
      spawnedThreadId: null,
    });
    await expect(
      host.harness.behavior.callAgentTool(
        "bind_execution_owner",
        { idempotencyKey: "recovery", mode: "direct" },
        context,
      ),
    ).rejects.toThrow("Dispatch recovery is required");
    expect(host.harness.inspection.realtimeSignals).toEqual([
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "work", rootThreadId: THREAD_ID } },
      { channel: "work-sidebar:changed", payload: { family: "tasks", threadId: THREAD_ID } },
    ]);
  });
});
