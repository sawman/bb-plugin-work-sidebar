import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const workContextRoot = resolve(process.cwd(), "features/work-context");

function source(name: string) {
  return readFileSync(resolve(workContextRoot, name), "utf8");
}

function lineCount(name: string) {
  return source(name).split("\n").length;
}

describe("Work context composition architecture", () => {
  it("keeps the composition entrypoint thin and card responsibilities bounded", () => {
    expect(lineCount("views.tsx")).toBeLessThanOrEqual(140);
    expect(lineCount("status-card.tsx")).toBeLessThanOrEqual(260);
    expect(lineCount("work-item-card.tsx")).toBeLessThanOrEqual(760);
    expect(lineCount("goal-card.tsx")).toBeLessThanOrEqual(90);
    expect(lineCount("plan-card.tsx")).toBeLessThanOrEqual(100);
    expect(lineCount("tasks-card.tsx")).toBeLessThanOrEqual(220);
  });

  it("keeps existing semantic card, item-row, and disclosure ownership singular", () => {
    const files = [
      "card-state.tsx",
      "status-card.tsx",
      "work-item-card.tsx",
      "goal-card.tsx",
      "plan-card.tsx",
      "tasks-card.tsx",
      "background-jobs-view.tsx",
    ];
    const workSources = files.map((name) => [name, source(name)] as const);
    const declarations = (pattern: RegExp) =>
      workSources.filter(([, contents]) => pattern.test(contents));

    expect(declarations(/export function CardState/).map(([name]) => name)).toEqual([
      "card-state.tsx",
    ]);
    expect(declarations(/<SurfaceCardHeading/).map(([name]) => name)).toEqual([
      "card-state.tsx",
    ]);
    expect(declarations(/<TaskWorkflowCard/).map(([name]) => name)).toEqual([
      "tasks-card.tsx",
    ]);
    expect(declarations(/function (ActivityRow|QueueReference|WorkItemQueueActions)/).map(([name]) => name)).toEqual([
      "status-card.tsx",
      "work-item-card.tsx",
    ]);
  });
});
