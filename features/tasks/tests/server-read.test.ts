import { describe, expect, it } from "vitest";
import { readSidebarTasks } from "../server-read";

const adapter = (overrides: Partial<Parameters<typeof readSidebarTasks>[0]> = {}) => ({
  listTasks: async () => [{ id: "task-b", projectId: "project-b" }, { id: "task-a", projectId: "missing" }],
  readAssignees: async () => ({ "task-b": "agent" as const }),
  listProjects: async () => [{ id: "project-b", name: "Beta" }],
  listTaskThreads: async (taskId: string) => taskId === "task-b" ? [{ threadId: "thr_one" }] : [],
  taskId: (task: { id: string }) => task.id,
  projectId: (task: { projectId: string }) => task.projectId,
  projectIdOf: (project: { id: string }) => project.id,
  projectName: (project: { name: string }) => project.name,
  threadId: (thread: { threadId: string }) => thread.threadId,
  projectTask: (task: { id: string }, projectName: string, threadIds: string[], assignee: "agent" | "human") => ({ ...task, projectName, threadIds, assignee }),
  ...overrides,
});

describe("Tasks server read adapter", () => {
  it("projects projects, default names, assignees, and thread links in source order", async () => {
    await expect(readSidebarTasks(adapter())).resolves.toEqual({
      projects: [{ id: "project-b", name: "Beta" }],
      tasks: [
        { id: "task-b", projectId: "project-b", projectName: "Beta", threadIds: ["thr_one"], assignee: "agent" },
        { id: "task-a", projectId: "missing", projectName: "Work", threadIds: [], assignee: "human" },
      ],
    });
  });

  it("surfaces an independent task-link adapter failure", async () => {
    await expect(readSidebarTasks(adapter({ listTaskThreads: async () => { throw new Error("links unavailable"); } }))).rejects.toThrow("links unavailable");
  });
});
