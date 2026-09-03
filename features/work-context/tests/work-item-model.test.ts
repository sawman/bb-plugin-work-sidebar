import { describe, expect, it } from "vitest";
import type { TaskSummary } from "../../../work-model";
import {
  moveWorkItemToTasks,
  promoteWorkItem,
  projectWorkItem,
  resolveWorkItemQueue,
  workItemTaskKeyColumnWidthForVisibleRows,
  type WorkItemTrackerRecord,
} from "../work-item-model";

const outcome: TaskSummary = {
  id: "task_outcome",
  projectId: "project_tasks",
  projectName: "Work",
  key: "BBPLUG-1",
  title: "Ship the work sidebar",
  status: "in_progress",
  priority: "high",
  dueDate: null,
  parentTaskId: null,
};

const linear = (
  key: string,
  priority: string | null = null,
): WorkItemTrackerRecord => ({
  key,
  title: `${key} external outcome`,
  url: `https://linear.app/issue/${key}`,
  status: "In Progress",
  stateCategory: "in_progress",
  priority,
  assignee: null,
  project: "Sidebar",
  statusOptions: [],
});

describe("unified work item projection", () => {
  it("uses one key track for the rows visible in Work items", () => {
    expect(
      workItemTaskKeyColumnWidthForVisibleRows({
        queue: { current: { source: "linear", id: "LIN-1024" }, backlog: [] },
        tasks: [
          { id: "visible", key: "BBPLUG-72", linkedThreadIds: ["thr_work"] },
          { id: "hidden", key: "UNRELATED-10000", linkedThreadIds: ["thr_other"] },
        ],
        taskById: new Map(),
        linearByKey: new Map([["LIN-1024", { item: { key: "LIN-1024" } }]]),
        executionTasks: [{ key: "WORK-3" }],
        threadId: "thr_work",
        goalTaskIds: new Set(),
      }),
    ).toBe("9ch");
  });

  it("migrates existing outcome and Linear links into one explicit current goal and backlog", () => {
    expect(resolveWorkItemQueue({ outcome, linked: [linear("LIN-1"), linear("LIN-2")], primaryLinearKey: "LIN-2", queue: null })).toEqual({
      current: { source: "bb_task", id: outcome.id },
      backlog: [{ source: "linear", id: "LIN-1" }, { source: "linear", id: "LIN-2" }],
    });
    expect(resolveWorkItemQueue({ outcome: null, linked: [linear("LIN-1"), linear("LIN-2")], primaryLinearKey: "LIN-2", queue: null })).toEqual({
      current: { source: "linear", id: "LIN-2" },
      backlog: [{ source: "linear", id: "LIN-1" }],
    });
  });

  it("promotes a backlog goal by swapping it with the current goal", () => {
    const initial = { current: { source: "linear" as const, id: "LIN-1" }, backlog: [{ source: "bb_task" as const, id: "task-2" }, { source: "linear" as const, id: "LIN-3" }] };
    expect(promoteWorkItem(initial, { source: "bb_task", id: "task-2" })).toEqual({
      current: { source: "bb_task", id: "task-2" },
      backlog: [{ source: "linear", id: "LIN-1" }, { source: "linear", id: "LIN-3" }],
    });
  });

  it("honors an explicitly persisted empty queue instead of reviving legacy work", () => {
    expect(resolveWorkItemQueue({
      outcome,
      linked: [linear("LIN-1")],
      primaryLinearKey: "LIN-1",
      queue: { current: null, backlog: [] },
    })).toEqual({ current: null, backlog: [] });
  });

  it("moves a goal into execution by promoting only the first remaining backlog item", () => {
    const queue = {
      current: { source: "linear" as const, id: "LIN-1" },
      backlog: [
        { source: "bb_task" as const, id: "task-2" },
        { source: "linear" as const, id: "LIN-3" },
      ],
    };
    expect(moveWorkItemToTasks(queue, queue.current)).toEqual({
      current: { source: "bb_task", id: "task-2" },
      backlog: [{ source: "linear", id: "LIN-3" }],
    });
    expect(moveWorkItemToTasks(queue, queue.backlog[1]!)).toEqual({
      current: queue.current,
      backlog: [{ source: "bb_task", id: "task-2" }],
    });
  });
  it("keeps the BB outcome canonical while ordering one primary Linear record first", () => {
    expect(
      projectWorkItem({
        outcome,
        linked: [linear("LIN-2"), linear("LIN-1")],
        primaryLinearKey: "LIN-1",
        legacyState: "none",
      }),
    ).toEqual({
      state: "managed",
      outcome,
      linked: [linear("LIN-1"), linear("LIN-2")],
      primaryLinearKey: "LIN-1",
      createFromLinear: null,
      queue: {
        current: { source: "bb_task", id: outcome.id },
        backlog: [
          { source: "linear", id: "LIN-2" },
          { source: "linear", id: "LIN-1" },
        ],
      },
    });
  });

  it("offers an explicit one-time BB outcome seed for Linear-only work", () => {
    expect(
      projectWorkItem({
        outcome: null,
        linked: [linear("LIN-8", "High")],
        primaryLinearKey: null,
        legacyState: "none",
      }),
    ).toEqual({
      state: "external_only",
      outcome: null,
      linked: [linear("LIN-8", "High")],
      primaryLinearKey: "LIN-8",
      createFromLinear: {
        key: "LIN-8",
        title: "LIN-8 external outcome",
        priority: "high",
      },
      queue: { current: { source: "linear", id: "LIN-8" }, backlog: [] },
    });
  });

  it("distinguishes empty and legacy-adoptable states without inventing a task", () => {
    expect(
      projectWorkItem({
        outcome: null,
        linked: [],
        primaryLinearKey: null,
        legacyState: "none",
      }),
    ).toMatchObject({ state: "empty", outcome: null, linked: [] });
    expect(
      projectWorkItem({
        outcome: null,
        linked: [],
        primaryLinearKey: null,
        legacyState: "adoptable",
      }),
    ).toMatchObject({ state: "legacy_adoptable", outcome: null, linked: [] });
  });

  it("falls back to the first linked issue when a stored primary is stale", () => {
    expect(
      projectWorkItem({
        outcome,
        linked: [linear("LIN-3"), linear("LIN-4")],
        primaryLinearKey: "LIN-missing",
        legacyState: "none",
      }).primaryLinearKey,
    ).toBe("LIN-3");
  });

  it("maps Linear priority once through the exact case-insensitive BB vocabulary", () => {
    for (const [linearPriority, taskPriority] of [
      ["URGENT", "urgent"],
      [" medium ", "medium"],
      ["Low", "low"],
      ["No priority", "none"],
      [null, "none"],
    ] as const)
      expect(
        projectWorkItem({
          outcome: null,
          linked: [linear("LIN-priority", linearPriority)],
          primaryLinearKey: null,
          legacyState: "none",
        }).createFromLinear?.priority,
      ).toBe(taskPriority);
  });
});
