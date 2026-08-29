import { describe, expect, it } from "vitest";
import {
  projectTaskWorkflow,
  type TaskWorkflowOwner,
  type TaskWorkflowRecord,
} from "../workflow-model";

const task = (
  id: string,
  status: TaskWorkflowRecord["status"],
  assignee: TaskWorkflowRecord["assignee"],
  options: Partial<Pick<TaskWorkflowRecord, "priority">> & {
    completedAt?: number;
  } = {},
): TaskWorkflowRecord => ({
  id,
  projectId: "project_tasks",
  projectName: "Work",
  key: `WORK-${id}`,
  title: `Task ${id}`,
  status,
  priority: options.priority ?? "medium",
  dueDate: null,
  parentTaskId: id === "outcome" ? null : "outcome",
  assignee,
  ...(options.completedAt === undefined
    ? {}
    : { completedAt: options.completedAt }),
});

const owner = (
  taskId: string,
  liveStatus: TaskWorkflowOwner["liveStatus"],
  options: { isArchived?: boolean } = {},
): TaskWorkflowOwner => ({
  taskId,
  threadId: `thr_${taskId}`,
  threadTitle: `Thread ${taskId}`,
  providerId: "codex",
  liveStatus,
  ...(options.isArchived ? { isArchived: true } : {}),
});

describe("task workflow projection", () => {
  it("projects every non-outcome task into exactly one workflow section", () => {
    const result = projectTaskWorkflow({
      outcomeTaskId: "outcome",
      tasks: [
        task("outcome", "in_progress", "agent"),
        task("human", "todo", "human"),
        task("agent", "in_progress", "agent"),
        task("next", "backlog", "agent"),
        task("done", "done", "agent"),
        task("canceled", "canceled", "human"),
      ],
      owners: [owner("agent", "working")],
    });

    expect(result.needsYou.map(({ task }) => task.id)).toEqual(["human"]);
    expect(result.inProgress.map(({ task }) => task.id)).toEqual(["agent"]);
    expect(result.next.map(({ task }) => task.id)).toEqual(["next"]);
    expect(result.completed.map(({ task }) => task.id)).toEqual([
      "done",
      "canceled",
    ]);
    expect(
      [
        ...result.needsYou,
        ...result.inProgress,
        ...result.next,
        ...result.completed,
      ].map(({ task }) => task.id),
    ).toEqual(["human", "agent", "next", "done", "canceled"]);
  });

  it("treats Human review as follow-up and active owner runtime as progress", () => {
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [
        task("decision", "in_review", "human"),
        task("starting", "todo", "agent"),
      ],
      owners: [owner("starting", "starting")],
    });

    expect(result.needsYou[0]?.task.id).toBe("decision");
    expect(result.inProgress[0]).toMatchObject({
      task: { id: "starting" },
      owner: { threadId: "thr_starting" },
    });
  });

  it("deduplicates transitional task sources and prefers the populated owner", () => {
    const duplicate = task("shared", "in_progress", "agent");
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [duplicate, { ...duplicate, title: "Refreshed task" }],
      owners: [owner("shared", "idle"), owner("shared", "working")],
    });

    expect(result.inProgress).toHaveLength(1);
    expect(result.inProgress[0]).toMatchObject({
      task: { title: "Refreshed task" },
      owner: { liveStatus: "working" },
    });
  });

  it("lets an execution record replace the generic duplicate regardless of source order", () => {
    const generic = task("shared", "todo", "human", { priority: "low" });
    const execution = {
      ...task("shared", "in_progress", "agent", { priority: "urgent" }),
      title: "Execution record",
    };
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [generic],
      executionTasks: [execution],
      owners: [],
    });

    expect(result.inProgress).toHaveLength(1);
    expect(result.inProgress[0]?.task).toMatchObject({
      id: "shared",
      title: "Execution record",
      priority: "urgent",
    });
    expect(result.needsYou).toEqual([]);
  });

  it("sorts each bucket by active liveness where applicable, then priority, status, and key", () => {
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [
        task("human-todo", "todo", "human", { priority: "urgent" }),
        task("human-review", "in_review", "human", { priority: "urgent" }),
        task("human-high", "backlog", "human", { priority: "high" }),
        task("agent-missing", "in_progress", "agent"),
        task("agent-starting", "todo", "agent"),
        task("agent-working", "todo", "agent"),
        task("next-z", "backlog", "agent", { priority: "low" }),
        task("next-a", "todo", "agent", { priority: "low" }),
      ],
      owners: [
        owner("agent-missing", "idle"),
        owner("agent-starting", "starting"),
        owner("agent-working", "working"),
      ],
    });

    expect(result.needsYou.map(({ task: item }) => item.id)).toEqual([
      "human-review",
      "human-todo",
      "human-high",
    ]);
    expect(result.inProgress.map(({ task: item }) => item.id)).toEqual([
      "agent-working",
      "agent-starting",
      "agent-missing",
    ]);
    expect(result.next.map(({ task: item }) => item.id)).toEqual([
      "next-a",
      "next-z",
    ]);
  });

  it("retains archived and missing owners as unavailable workflow metadata", () => {
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [
        task("archived-owner", "todo", "agent"),
        task("missing-owner", "todo", "agent"),
      ],
      owners: [owner("archived-owner", "working", { isArchived: true })],
    });

    expect(result.next.map(({ task: item }) => item.id)).toEqual([
      "archived-owner",
      "missing-owner",
    ]);
    expect(result.next[0]).toMatchObject({
      owner: { isArchived: true },
      ownerUnavailable: true,
    });
    expect(result.next[1]).toMatchObject({
      owner: null,
      ownerUnavailable: true,
    });
  });

  it("keeps canceled status distinct and exposes only the five most recent completions", () => {
    const result = projectTaskWorkflow({
      outcomeTaskId: null,
      tasks: [
        task("old-done", "done", "agent", { completedAt: 1 }),
        task("new-canceled", "canceled", "agent", { completedAt: 7 }),
        task("middle-done", "done", "agent", { completedAt: 3 }),
        task("new-done", "done", "agent", { completedAt: 6 }),
        task("older-canceled", "canceled", "agent", { completedAt: 2 }),
        task("latest-done", "done", "agent", { completedAt: 8 }),
        task("middle-canceled", "canceled", "agent", { completedAt: 4 }),
      ],
      owners: [],
    });

    expect(result.completed.map(({ task: item }) => item.id)).toEqual([
      "latest-done",
      "new-canceled",
      "new-done",
      "middle-canceled",
      "middle-done",
    ]);
    expect(result.completed.map(({ task: item }) => item.status)).toContain(
      "canceled",
    );
    expect(result.completedTotal).toBe(7);
    expect(result.hasMoreCompleted).toBe(true);
  });
});
