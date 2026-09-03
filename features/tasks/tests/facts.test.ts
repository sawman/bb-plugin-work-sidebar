import { describe, expect, it } from "vitest";
import {
  MAX_TASK_FACTS_PER_PROJECT,
  adaptSidebarTaskResponse,
  adaptTaskLinkResponse,
  adaptWorkOutcomeResponse,
  mergeTaskFacts,
  resolveSidebarTasks,
  resolveTaskLinks,
  resolveWorkOutcome,
} from "../facts";

const task = {
  id: "task_1",
  projectId: "task_project",
  projectName: "Work",
  key: "WORK-1",
  title: "Canonical task",
  status: "in_progress" as const,
  priority: "high" as const,
  dueDate: null,
  parentTaskId: "outcome_1",
  updatedAt: "2026-09-04T01:00:00.000Z",
  position: 1024,
  linkedThreadIds: ["thr_child"],
  assignee: "agent" as const,
};
const {
  linkedThreadIds: _linkedThreadIds,
  assignee: _assignee,
  position: _position,
  ...taskSummary
} = task;

describe("canonical TaskFact directory", () => {
  it("normalizes surface payloads into one fact and task-id-only relationships", () => {
    const sidebar = adaptSidebarTaskResponse("project_scope", {
      available: true,
      tasks: [task],
      projects: [{ id: "task_project", name: "Work" }],
      error: null,
    });
    const links = adaptTaskLinkResponse({
      available: true,
      links: {
        thr_child: [{
          task: taskSummary,
          threadId: "thr_child",
          threadTitle: "Child",
          liveStatus: "working" as const,
          role: "execution" as const,
          mode: "delegated" as const,
          idempotencyKey: "child-1",
          dispatchState: "ready" as const,
        }],
      },
      error: null,
    });
    const outcome = adaptWorkOutcomeResponse({
      rootThreadId: "thr_root",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [{ ...taskSummary, assignee: task.assignee }],
      bindings: [],
      legacy: { state: "none" as const, taskIds: [], message: null },
    });
    const directory = mergeTaskFacts(
      undefined,
      "project_scope",
      [...sidebar.facts, ...links.facts, ...outcome.facts],
    );

    expect(Object.keys(directory.facts)).toEqual(["task_1"]);
    expect(sidebar.relationships).toEqual([{
      taskId: "task_1",
      linkedThreadIds: ["thr_child"],
    }]);
    expect(links.references.links.thr_child?.[0]).toMatchObject({
      taskId: "task_1",
      threadId: "thr_child",
    });
    expect(links.references.links.thr_child?.[0]).not.toHaveProperty("task");
    expect(outcome.references).toMatchObject({
      outcomeTaskId: null,
      executionTaskIds: ["task_1"],
    });
    expect(outcome.references).not.toHaveProperty("outcome");
    expect(outcome.references).not.toHaveProperty("executionTasks");

    expect(resolveSidebarTasks(sidebar.references, sidebar.relationships, directory).tasks[0]).toEqual(task);
    expect(resolveTaskLinks(links.references, directory).links.thr_child?.[0]?.task).toMatchObject({
      id: "task_1",
      title: "Canonical task",
    });
    expect(resolveWorkOutcome(outcome.references, directory).executionTasks[0]).toMatchObject({
      id: "task_1",
      title: "Canonical task",
      assignee: "agent",
    });
  });

  it("keeps the newest fact authoritative across surfaces and resets on project change", () => {
    const current = mergeTaskFacts(undefined, "project_a", [task]);
    const stale = mergeTaskFacts(current, "project_a", [{
      ...task,
      title: "Stale title",
      status: "todo",
      updatedAt: "2026-09-03T01:00:00.000Z",
    }]);
    expect(stale.facts.task_1).toMatchObject({
      title: "Canonical task",
      status: "in_progress",
    });

    const changedProject = mergeTaskFacts(stale, "project_b", [{
      ...task,
      id: "task_2",
      key: "OTHER-2",
    }]);
    expect(changedProject.projectId).toBe("project_b");
    expect(Object.keys(changedProject.facts)).toEqual(["task_2"]);
  });

  it("bounds retained facts and treats a refresh as recent use", () => {
    const incoming = Array.from(
      { length: MAX_TASK_FACTS_PER_PROJECT + 1 },
      (_, index) => ({
        ...task,
        id: `task_${index}`,
        key: `WORK-${index}`,
        updatedAt: new Date(index).toISOString(),
      }),
    );
    const directory = mergeTaskFacts(undefined, "project_scope", incoming);
    expect(Object.keys(directory.facts)).toHaveLength(MAX_TASK_FACTS_PER_PROJECT);
    expect(directory.facts.task_0).toBeUndefined();

    const refreshed = mergeTaskFacts(directory, "project_scope", [incoming[1]!]);
    expect(Object.keys(refreshed.facts).at(-1)).toBe("task_1");
  });
});
