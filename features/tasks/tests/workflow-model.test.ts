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
): TaskWorkflowRecord => ({
  id,
  projectId: "project_tasks",
  projectName: "Work",
  key: `WORK-${id}`,
  title: `Task ${id}`,
  status,
  priority: "medium",
  dueDate: null,
  parentTaskId: id === "outcome" ? null : "outcome",
  assignee,
});

const owner = (
  taskId: string,
  liveStatus: TaskWorkflowOwner["liveStatus"],
): TaskWorkflowOwner => ({
  taskId,
  threadId: `thr_${taskId}`,
  threadTitle: `Thread ${taskId}`,
  providerId: "codex",
  liveStatus,
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
});
