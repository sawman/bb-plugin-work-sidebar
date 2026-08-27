import { describe, expect, it } from "vitest";
import {
  goalProgressPercent,
  orderTasks,
  reorderTaskSiblings,
  sanitizeThreadOrder,
  taskMatchesSearch,
  readableStatus,
  runtimeStatusPresentation,
  type SidebarTask,
} from "./work-model";
import { normalizeThreadGroups } from "./server";

function task(overrides: Partial<SidebarTask> = {}): SidebarTask {
  return {
    id: "task-1",
    projectId: "project-1",
    projectName: "Work",
    key: "WORK-1",
    title: "Ship the sidebar",
    status: "todo",
    priority: "none",
    dueDate: null,
    parentTaskId: null,
    linkedThreadIds: [],
    assignee: "human",
    ...overrides,
  };
}

describe("thread order persistence", () => {
  it("rejects invalid and duplicate persisted ids", () => {
    expect(sanitizeThreadOrder(["thr_one", "bad", "thr_one", " thr_two "])).toEqual(["thr_one", "thr_two"]);
  });

});

describe("custom thread groups", () => {
  it("migrates Later and keeps every thread in only one group", () => {
    expect(normalizeThreadGroups(undefined, ["thr_later", "thr_later"]))
      .toEqual([{ id: "group_later", name: "Later", threadIds: ["thr_later"] }]);
    expect(normalizeThreadGroups({ groups: [
      { id: "group_later", name: "Later", threadIds: ["thr_one", "thr_two"] },
      { id: "group_next", name: "Next", threadIds: ["thr_two", "thr_three"] },
    ] })).toEqual([
      { id: "group_later", name: "Later", threadIds: ["thr_one", "thr_two"] },
      { id: "group_next", name: "Next", threadIds: ["thr_three"] },
    ]);
  });
});

describe("task ordering", () => {
  it("orders active work before backlog and completed work", () => {
    expect(orderTasks([
      task({ id: "done", key: "W-3", status: "done" }),
      task({ id: "todo", key: "W-2", status: "todo" }),
      task({ id: "progress", key: "W-1", status: "in_progress" }),
    ]).map((item) => item.id)).toEqual(["progress", "todo", "done"]);
  });

  it("reorders manual siblings without mutating the input", () => {
    const tasks = [task({ id: "a", key: "A", position: 0 }), task({ id: "b", key: "B", position: 1 }), task({ id: "c", key: "C", position: 2 })];
    expect(reorderTaskSiblings(tasks, "c", "a", "before").map((item) => [item.id, item.position])).toEqual([["a", 2048], ["b", 3072], ["c", 1024]]);
    expect(tasks.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("matches key, title, project, priority, and status", () => {
    expect(taskMatchesSearch(task({ priority: "high" }), "HIGH")).toBe(true);
    expect(taskMatchesSearch(task(), "not present")).toBe(false);
  });
});

describe("goal progress", () => {
  it("returns null when no measurable budget exists and clamps percentages", () => {
    expect(goalProgressPercent({ tokenBudget: null, tokensUsed: 5 })).toBeNull();
    expect(goalProgressPercent({ tokenBudget: 10, tokensUsed: 14 })).toBe(100);
  });
});

describe("runtime presentation", () => {
  it("uses stable labels and tones for harness state", () => {
    expect(runtimeStatusPresentation({ status: "active", runtimeStatus: "waiting_for_input" })).toEqual({ label: "Waiting", tone: "waiting" });
    expect(runtimeStatusPresentation({ status: "error", runtimeStatus: "idle" })).toEqual({ label: "Blocked", tone: "blocked" });
    expect(readableStatus("in_review")).toBe("In Review");
  });
});
