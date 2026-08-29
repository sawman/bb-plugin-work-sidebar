import { describe, expect, it } from "vitest";
import type { TaskSummary } from "../../../work-model";
import {
  projectWorkItem,
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
