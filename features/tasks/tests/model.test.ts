import { describe, expect, it } from "vitest";
import { taskStatusPresentation, type TaskStatus } from "../model";

describe("Tasks status presentation", () => {
  it("covers every persisted status exactly", () => {
    expect(["backlog", "todo", "in_progress", "in_review", "done", "canceled"].map((status) => taskStatusPresentation(status as TaskStatus))).toEqual([
      { label: "Backlog", tone: "backlog" }, { label: "To do", tone: "todo" }, { label: "In Progress", tone: "progress" },
      { label: "In Review", tone: "review" }, { label: "Done", tone: "complete" }, { label: "Canceled", tone: "canceled" },
    ]);
  });
});
