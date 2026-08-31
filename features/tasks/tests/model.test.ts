import { describe, expect, it } from "vitest";
import { taskStatusPresentation, type TaskStatus } from "../model";

describe("Tasks status presentation", () => {
  it("covers every persisted status exactly", () => {
    expect(["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((status) => taskStatusPresentation(status as TaskStatus))).toEqual([
      { label: "Backlog", tone: "backlog", icon: "ListTodo" },
      { label: "To do", tone: "todo", icon: "Circle" },
      { label: "In Progress", tone: "progress", icon: "Hammer" },
      { label: "In Review", tone: "review", icon: "Eye" },
      { label: "Done", tone: "complete", icon: "Check" },
      { label: "Canceled", tone: "canceled", icon: "X" },
    ]);
  });
});
