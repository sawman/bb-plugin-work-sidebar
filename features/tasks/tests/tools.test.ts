import { describe, expect, it, vi } from "vitest";
import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../../../server";
import { WORK_AGENT_INSTRUCTIONS } from "../server-service";

const TASK_ID = "01M13DFQ4H0THGGYX5MNR52QKB";
const PROJECT_ID = "01M110X2HHBYGSGJAB5ZBW382N";
const COMMENT_ID = "01M13E0N7JP9M4K5DVEW8G3QZT";
const THREAD_ID = "thr_tools";

function task() {
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

function fixture() {
  let current = task();
  const callRpc = vi.fn(async ({ method, input }: { method: string; input?: unknown }) => {
    const value = input as Record<string, unknown> | null;
    if (method === "getTaskByKey")
      return { task: value?.taskKey === current.key ? current : null };
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
        taskThreads: [
          {
            id: "01M13E1M4MKM1QYN8C0P4A2R7F",
            taskId: TASK_ID,
            threadId: THREAD_ID,
            presetName: "Direct",
            title: "Task tools",
            liveStatus: "working",
            attachedAt: "2026-08-28T00:00:00.000Z",
            updatedAt: "2026-08-28T00:00:00.000Z",
          },
        ],
      };
    if (method === "updateTask") {
      const { taskId: _taskId, authorName: _authorName, ...changes } = value ?? {};
      current = { ...current, ...changes } as typeof current;
      return { ok: true, task: current };
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
  const host = createFakePluginHost({ sdk: { plugins: { callRpc } } });
  return { host, callRpc };
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

  it("updates safe task fields and assignment, then publishes one Tasks invalidation", async () => {
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
  });
});
