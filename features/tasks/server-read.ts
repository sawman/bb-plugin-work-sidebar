/** Server-side Tasks read adapter. The entrypoint supplies host-specific RPC calls. */
export async function readSidebarTasks<Task, Project, Thread, Result>(adapter: {
  listTasks(): Promise<Task[]>;
  readAssignees(): Promise<Record<string, "agent" | "human">>;
  listProjects(): Promise<Project[]>;
  listTaskThreads(taskId: string): Promise<Thread[]>;
  taskId(task: Task): string;
  projectId(task: Task): string;
  projectIdOf(project: Project): string;
  projectName(project: Project): string;
  threadId(thread: Thread): string;
  projectTask(task: Task, projectName: string, threadIds: string[], assignee: "agent" | "human"): Result;
}): Promise<{ tasks: Result[]; projects: { id: string; name: string }[] }> {
  const [tasks, assignees, projects] = await Promise.all([
    adapter.listTasks(), adapter.readAssignees(), adapter.listProjects(),
  ]);
  const projectNames = new Map(projects.map((project) => [adapter.projectIdOf(project), adapter.projectName(project)]));
  const result = await Promise.all(tasks.map(async (task) => {
    const id = adapter.taskId(task);
    const threads = await adapter.listTaskThreads(id);
    return adapter.projectTask(task, projectNames.get(adapter.projectId(task)) ?? "Work", threads.map(adapter.threadId), assignees[id] ?? "human");
  }));
  return { tasks: result, projects: projects.map((project) => ({ id: adapter.projectIdOf(project), name: adapter.projectName(project) })) };
}
