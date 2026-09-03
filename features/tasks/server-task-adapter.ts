import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createPluginRpcCaller, type PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import { projectSidebarTask, summarizeTask } from "./server-model.js";
import { readSidebarTasks } from "./server-read.js";
import { pluginStorageDatabase } from "../../shared/server-storage.js";

const TASKS_PLUGIN_ID = "tasks";
export const TASK_ASSIGNEES_KEY = "sidebar-task-assignees:v1";
const TASK_ASSIGNEES_MIGRATION_KEY = "sidebar-task-assignees-v1-imported";
const taskIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
export const taskThreadIdSchema = z.string().startsWith("thr_");
export const taskSchema = z.object({
  id: taskIdSchema, projectId: taskIdSchema, number: z.number().int().positive(), key: z.string(),
  title: z.string(), description: z.string(),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]),
  dueDate: z.string().nullable(), parentTaskId: taskIdSchema.nullable(), position: z.number(),
  createdAt: z.string(), updatedAt: z.string(), labelIds: z.array(taskIdSchema),
});
export const taskThreadSchema = z.object({
  id: taskIdSchema, taskId: taskIdSchema, threadId: taskThreadIdSchema, presetName: z.string(),
  title: z.string(), liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
  attachedAt: z.string(), updatedAt: z.string(),
});
const taskCommentSchema = z.object({
  id: taskIdSchema,
  taskId: taskIdSchema,
  kind: z.enum(["user", "agent", "system"]),
  authorName: z.string(),
  presetName: z.string().nullable(),
  threadId: taskThreadIdSchema.nullable(),
  body: z.string(),
  notifiedCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
const displayTaskCommentSchema = taskCommentSchema.extend({
  threadTitle: z.string().nullable(),
  provider: z.object({
    id: z.string(),
    name: z.string(),
    logoUrl: z.string().nullable(),
  }).nullable(),
});
export const projectSchema = z.object({
  id: taskIdSchema, name: z.string(), prefix: z.string(), nextTaskNumber: z.number().int().positive(),
  color: z.string(), folderId: taskIdSchema.nullable(), linkedBbProjectId: z.string().startsWith("proj_").nullable(),
  createdAt: z.string(),
});
const taskPageSchema = z.object({ tasks: z.array(taskSchema), nextCursor: z.string().nullable() });
const STALE_TASK_LIST_CURSOR_MESSAGE =
  "task-list data changed after this cursor was issued; restart pagination without --cursor";
export const taskMutationSchema = z.union([
  z.object({ ok: z.literal(true), task: taskSchema }),
  z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
]);

export type Task = z.infer<typeof taskSchema>;
export type Project = z.infer<typeof projectSchema>;
export type TaskSummary = ReturnType<typeof summarizeTask>;
export type TaskStatus = Task["status"];
export type TaskAssignee = "agent" | "human";
export type TaskUpdate = Partial<
  Pick<Task, "title" | "description" | "status" | "priority" | "dueDate">
>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isStaleTaskListCursorError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  if (error.code === "stale_cursor") return true;
  if (error.code !== "handler_error" || !isRecord(error.body)) return false;
  const boundaryError = error.body.error;
  return isRecord(boundaryError) &&
    boundaryError.code === "handler_error" &&
    boundaryError.message === STALE_TASK_LIST_CURSOR_MESSAGE;
}

/** Validated bridge to the Tasks plugin; no durable work-binding policy lives here. */
export function createTasksPluginAdapter(bb: BbPluginApi) {
  const database = pluginStorageDatabase(bb);
  let assigneeMigration: Promise<void> | null = null;
  const assigneeMigrationComplete = () => Boolean(
    database
      .prepare<[string], { value: string }>(
        "SELECT value FROM sidebar_task_assignee_metadata WHERE key = ?",
      )
      .get(TASK_ASSIGNEES_MIGRATION_KEY),
  );
  const ensureAssigneeMigration = async () => {
    if (!assigneeMigration) {
      assigneeMigration = (async () => {
        if (assigneeMigrationComplete()) return;
        const legacy = await bb.storage.kv.get<unknown>(TASK_ASSIGNEES_KEY);
        if (isRecord(legacy)) {
          const insert = database.prepare(
            `INSERT INTO sidebar_task_assignee_state (task_id, assignee, updated_at)
             VALUES (?, ?, ?)
             ON CONFLICT(task_id) DO NOTHING`,
          );
          const now = new Date().toISOString();
          for (const [taskId, assignee] of Object.entries(legacy)) {
            if (assignee === "agent" || assignee === "human")
              insert.run(taskId, assignee, now);
          }
        }
        database
          .prepare(
            `INSERT INTO sidebar_task_assignee_metadata (key, value)
             VALUES (?, ?)
             ON CONFLICT(key) DO NOTHING`,
          )
          .run(TASK_ASSIGNEES_MIGRATION_KEY, new Date().toISOString());
        await bb.storage.kv.delete(TASK_ASSIGNEES_KEY);
      })();
    }
    await assigneeMigration;
  };
  const callPluginRpc = createPluginRpcCaller(bb);
  const call = <T>(method: string, input: PluginRpcInput, outputSchema: z.ZodType<T>) =>
    callPluginRpc(TASKS_PLUGIN_ID, method, input, outputSchema);
  const available = async () => {
    try {
      return (await call("ping", null, z.object({ ok: z.literal(true), version: z.string() }))).ok;
    } catch {
      return false;
    }
  };
  const listAll = async (input: { activeOnly: boolean; sort: "manual" | "priority" | "due"; parentTaskId?: string }): Promise<Task[]> => {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const tasks = new Map<string, Task>();
      let cursor: string | undefined;
      try {
        do {
          const page = await call("listTasks", {
            activeOnly: input.activeOnly,
            sort: input.sort,
            limit: 500,
            ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}),
            ...(cursor ? { cursor } : {}),
          }, taskPageSchema);
          for (const task of page.tasks) tasks.set(task.id, task);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        return [...tasks.values()];
      } catch (error) {
        if (attempt === 0 && cursor !== undefined && isStaleTaskListCursorError(error))
          continue;
        throw error;
      }
    }
    throw new Error("Task pagination retry limit exhausted");
  };
  const projects = async () =>
    (await call("listProjects", {}, z.object({ projects: z.array(projectSchema) }))).projects;
  const getByKey = async (key: string) =>
    (await call("getTaskByKey", { taskKey: key }, z.object({ task: taskSchema.nullable() }))).task;
  const comments = async (taskId: string) =>
    (await call("listComments", { taskId }, z.object({ comments: z.array(displayTaskCommentSchema) }))).comments;
  const threads = async (taskId: string) =>
    (await call("listTaskThreads", { taskId }, z.object({ taskThreads: z.array(taskThreadSchema) }))).taskThreads;
  const allTasksById = async () => new Map(
    (await listAll({ activeOnly: false, sort: "manual" })).map((task) => [task.id, task]),
  );
  const readAssignees = async (): Promise<Record<string, TaskAssignee>> => {
    await ensureAssigneeMigration();
    return Object.fromEntries(
      database
        .prepare<[], { task_id: string; assignee: TaskAssignee }>(
          "SELECT task_id, assignee FROM sidebar_task_assignee_state",
        )
        .all()
        .map((row) => [row.task_id, row.assignee]),
    );
  };
  const writeAssignee = async (taskId: string, assignee: TaskAssignee) => {
    await ensureAssigneeMigration();
    database
      .prepare(
        `INSERT INTO sidebar_task_assignee_state (task_id, assignee, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(task_id) DO UPDATE SET
           assignee = excluded.assignee,
           updated_at = excluded.updated_at`,
      )
      .run(taskId, assignee, new Date().toISOString());
    return { taskId, assignee };
  };
  const pruneInactiveAssignees = async (activeTaskIds: ReadonlySet<string>) => {
    await ensureAssigneeMigration();
    const stale = database
      .prepare<[], { task_id: string }>(
        "SELECT task_id FROM sidebar_task_assignee_state",
      )
      .all()
      .filter((row) => !activeTaskIds.has(row.task_id));
    const remove = database.prepare<[string]>(
      "DELETE FROM sidebar_task_assignee_state WHERE task_id = ?",
    );
    for (const row of stale) remove.run(row.task_id);
  };
  const sidebar = async () => {
    const activeTasks = await listAll({ activeOnly: true, sort: "priority" });
    await pruneInactiveAssignees(new Set(activeTasks.map((task) => task.id)));
    return readSidebarTasks({
    listTasks: async () => activeTasks,
    readAssignees,
    listProjects: projects,
    listTaskThreads: async (taskId) => (await call("listTaskThreads", { taskId }, z.object({ taskThreads: z.array(taskThreadSchema) }))).taskThreads,
    taskId: (task) => task.id,
    projectId: (task) => task.projectId,
    projectIdOf: (project) => project.id,
    projectName: (project) => project.name,
    threadId: (thread) => thread.threadId,
    projectTask: projectSidebarTask,
    });
  };
  const update = async (taskId: string, status: TaskStatus) => {
    const result = await call("updateTask", { taskId, status, authorName: "Work Sidebar" }, taskMutationSchema);
    if (!result.ok) throw new Error(result.error.message);
    return { task: summarizeTask(result.task) };
  };
  const updateFields = async (taskId: string, changes: TaskUpdate) => {
    const result = await call(
      "updateTask",
      { taskId, ...changes, authorName: "Work Sidebar Agent" },
      taskMutationSchema,
    );
    if (!result.ok) throw new Error(result.error.message);
    return result.task;
  };
  const comment = async (taskId: string, body: string, notify: boolean) =>
    (await call(
      "createComment",
      { taskId, body, notify },
      z.object({ comment: taskCommentSchema }),
    )).comment;
  const createSidebar = async (projectId: string, title: string, assignee: TaskAssignee) => {
    const result = await call("createTask", {
      projectId, title, description: "", status: "todo", priority: "medium", dueDate: null,
      parentTaskId: null, labelIds: [],
    }, taskMutationSchema);
    if (!result.ok) throw new Error(result.error.message);
    await writeAssignee(result.task.id, assignee);
    const name = (await projects()).find((project) => project.id === projectId)?.name ?? "Work";
    return { task: projectSidebarTask(result.task, name, [], assignee) };
  };
  const deleteSidebar = async (taskId: string) => {
    const result = await call("deleteTask", { taskId }, z.object({ deleted: z.boolean() }));
    if (!result.deleted) return result;
    await ensureAssigneeMigration();
    database
      .prepare<[string]>("DELETE FROM sidebar_task_assignee_state WHERE task_id = ?")
      .run(taskId);
    return result;
  };
  const reorder = async (taskId: string, beforeTaskId: string | null, afterTaskId: string | null) => {
    const current = (await call("getTask", { taskId }, z.object({ task: taskSchema.nullable() }))).task;
    if (!current) throw new Error(`Task not found: ${taskId}`);
    for (const neighborId of [beforeTaskId, afterTaskId]) {
      if (!neighborId) continue;
      const neighbor = (await call("getTask", { taskId: neighborId }, z.object({ task: taskSchema.nullable() }))).task;
      if (!neighbor || neighbor.projectId !== current.projectId || neighbor.status !== current.status || neighbor.parentTaskId !== current.parentTaskId) {
        throw new Error("Tasks can only be reordered among same-project, same-status siblings");
      }
    }
    const result = await call("boardMove", { taskId, status: current.status, beforeTaskId, afterTaskId, authorName: "Work Sidebar" }, taskMutationSchema);
    if (!result.ok) throw new Error(result.error.message);
    return { task: summarizeTask(result.task) };
  };
  return {
    call,
    available,
    listAll,
    projects,
    getByKey,
    comments,
    threads,
    allTasksById,
    readAssignees,
    writeAssignee,
    sidebar,
    update,
    updateFields,
    comment,
    createSidebar,
    deleteSidebar,
    reorder,
  };
}
