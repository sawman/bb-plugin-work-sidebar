import { describe, expect, it } from "vitest";
import {
  filterTasksForProject,
  orderTasksForPresentation,
  presentTask,
  taskAssigneePresentation,
  taskPriorityPresentation,
  taskStatusPresentation,
  tasksForThread,
  type TaskRecord,
} from "../model";

const task = (overrides: Partial<TaskRecord> = {}): TaskRecord => ({
  id: "task-1", projectId: "project-a", projectName: "Alpha", key: "ALPHA-1",
  title: "Ship Tasks", status: "todo", priority: "none", dueDate: null,
  parentTaskId: null, position: 1024, linkedThreadIds: [], assignee: "human",
  ...overrides,
});

describe("Tasks read presentation", () => {
  it("filters exactly by selected project and preserves unfiltered records", () => {
    const records = [task(), task({ id: "task-2", projectId: "project-b", projectName: "Beta" })];
    expect(filterTasksForProject(records, "project-a").map(({ id }) => id)).toEqual(["task-1"]);
    expect(filterTasksForProject(records, null)).toEqual(records);
  });

  it("presents exact status, priority, assignee, and thread links", () => {
    expect(presentTask(task({ status: "in_review", priority: "urgent", assignee: "agent", linkedThreadIds: ["thr_one"] }))).toMatchObject({
      status: { label: "In Review", tone: "review" },
      priority: { label: "Urgent", tone: "urgent" },
      assignee: { label: "Agent", icon: "Bot" },
      linkedThreadIds: ["thr_one"],
    });
  });

  it("covers every persisted status, priority, and assignee exactly", () => {
    expect(["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((status) => taskStatusPresentation(status as TaskRecord["status"]).label)).toEqual(["Backlog", "To do", "In Progress", "In Review", "Done", "Canceled"]);
    expect(["urgent", "high", "medium", "low", "none"].map((priority) => taskPriorityPresentation(priority as TaskRecord["priority"]).label)).toEqual(["Urgent", "High", "Medium", "Low", "No priority"]);
    expect(["human", "agent"].map((assignee) => taskAssigneePresentation(assignee as TaskRecord["assignee"]))).toEqual([{ label: "Human", icon: "User" }, { label: "Agent", icon: "Bot" }]);
  });

  it("orders manual siblings deterministically and projects only a thread's links", () => {
    const records = [task({ id: "later", key: "ALPHA-2", position: 2048 }), task({ id: "first", position: 1024, linkedThreadIds: ["thr_one"] })];
    expect(orderTasksForPresentation(records).map(({ id }) => id)).toEqual(["first", "later"]);
    expect(tasksForThread(records, "thr_one").map(({ id }) => id)).toEqual(["first"]);
  });
});
