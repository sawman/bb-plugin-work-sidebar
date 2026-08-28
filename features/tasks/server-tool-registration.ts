import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { summarizeTask } from "./server-model.js";
import type { createTasksPluginAdapter } from "./server-task-adapter.js";
import type { createWorkBindingsService } from "./server-work-bindings.js";

type TaskAdapter = ReturnType<typeof createTasksPluginAdapter>;
type WorkBindingsService = ReturnType<typeof createWorkBindingsService>;

/** Agent tool registration is separate from task RPC and durable binding policy. */
export function registerTasksTools(
  bb: BbPluginApi,
  tasks: TaskAdapter,
  bindings: WorkBindingsService,
) {
  const taskKey = z.string().trim().min(1).max(40);
  const namedTask = async (task: Parameters<typeof summarizeTask>[0]) => {
    const projects = await tasks.projects();
    return summarizeTask(task, projects.find((project) => project.id === task.projectId)?.name ?? "Work");
  };
  const assignedTo = async (taskId: string) =>
    (await tasks.readAssignees())[taskId] ?? "human";
  const findTask = async (key: string) => {
    const task = await tasks.getByKey(key);
    if (!task) throw new Error(`Task not found: ${key}`);
    return task;
  };
  const taskDetails = async (task: Awaited<ReturnType<typeof findTask>>) => {
    const [projects, assignees] = await Promise.all([
      tasks.projects(),
      tasks.readAssignees(),
    ]);
    return {
      ...summarizeTask(
        task,
        projects.find((project) => project.id === task.projectId)?.name ?? "Work",
      ),
      assignee: assignees[task.id] ?? "human",
    };
  };
  bb.agents.registerTool({
    name: "create_work_task",
    description: "Ensure the one top-level outcome task and set its Human or Agent assignment.",
    parameters: z.object({
      title: z.string().trim().min(1),
      description: z.string(),
      taskProjectId: z.string().nullable().optional(),
      assignee: z.enum(["agent", "human"]).optional(),
    }).strict(),
    instructions: "Call get_work_context first. Outcomes are top-level only; execution units are direct children created with create_execution_task. Assign agent-owned work to Agent and explicit user follow-up to Human.",
    async execute(params, context) {
      const root = await bindings.rootThread(context.threadId);
      const result = await bindings.outcome({
        rootThreadId: root.id,
        title: params.title,
        description: params.description,
        taskProjectId: params.taskProjectId,
        assignee: params.assignee,
      });
      const task = await namedTask(result.task);
      const assignment = await assignedTo(result.task.id);
      return [
        `Work is tracked as ${task.key}: ${task.title}, assigned to ${assignment}.`,
        "Record meaningful milestones, then move fully validated work directly to done.",
        "Use in_review only while a named reviewer or concrete acceptance gate is pending.",
      ].join(" ");
    },
  });
  bb.agents.registerTool({
    name: "get_task",
    description: "Read one BB Task by key, including comments and attached worker threads.",
    parameters: z.object({ key: taskKey }).strict(),
    async execute({ key }) {
      const task = await findTask(key);
      const [details, comments, threads] = await Promise.all([
        taskDetails(task),
        tasks.comments(task.id),
        tasks.threads(task.id),
      ]);
      return JSON.stringify({ task: details, comments, threads });
    },
  });
  bb.agents.registerTool({
    name: "update_task",
    description: "Update safe fields or the Human/Agent assignment for one BB Task.",
    parameters: z.object({
      key: taskKey,
      title: z.string().trim().min(1).optional(),
      description: z.string().optional(),
      status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]).optional(),
      priority: z.enum(["urgent", "high", "medium", "low", "none"]).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      assignee: z.enum(["agent", "human"]).optional(),
    }).strict().refine(
      ({ title, description, status, priority, dueDate, assignee }) =>
        [title, description, status, priority, dueDate, assignee].some(
          (value) => value !== undefined,
        ),
      { message: "At least one task field or assignee must be updated." },
    ),
    async execute({ key, assignee, ...changes }, context) {
      const current = await findTask(key);
      const fields = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      );
      const updated = Object.keys(fields).length
        ? await tasks.updateFields(current.id, fields)
        : current;
      if (assignee) await tasks.writeAssignee(current.id, assignee);
      bb.realtime.publish("work-sidebar:changed", {
        family: "tasks",
        threadId: context.threadId,
      });
      return JSON.stringify({ task: await taskDetails(updated) });
    },
  });
  bb.agents.registerTool({
    name: "comment_task",
    description: "Add one substantive markdown comment to a BB Task.",
    parameters: z.object({
      key: taskKey,
      body: z.string().trim().min(1),
      notify: z.boolean().default(false),
    }).strict(),
    async execute({ key, body, notify }) {
      const task = await findTask(key);
      return JSON.stringify({
        taskKey: task.key,
        comment: await tasks.comment(task.id, body, notify),
      });
    },
  });
  bb.agents.registerTool({
    name: "get_work_context",
    description: "Read durable outcome, execution, ownership, recovery, and legacy-adoption context for the current work root.",
    parameters: z.object({ rootThreadId: z.string().optional() }),
    instructions: "Use at start, resume, and after compaction before creating tasks, dispatching work, or changing task status. This is a lookup tool, not a compaction hook.",
    async execute(params, context) {
      const root = await bindings.rootThread(params.rootThreadId ?? context.threadId);
      const snapshot = await bindings.context(root.id, root.projectId);
      const outcome = snapshot.bindings.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
      return JSON.stringify({ rootThreadId: root.id, outcome, executions: snapshot.bindings.executions.filter((binding) => binding.rootThreadId === root.id), legacy: snapshot.legacy });
    },
  });
  bb.agents.registerTool({
    name: "create_execution_task",
    description: "Create or reuse one direct execution subtask with explicit Human or Agent assignment.",
    parameters: z.object({
      rootThreadId: z.string().optional(),
      title: z.string().trim().min(1),
      description: z.string().default(""),
      idempotencyKey: z.string().trim().min(1).max(200),
      assignee: z.enum(["agent", "human"]).optional(),
    }).strict(),
    instructions: [
      "Call get_work_context first.",
      "This creates only a direct child of the durable top-level outcome; never create nested Tasks subtasks.",
      "Assign work the agent will execute to Agent; use Human when the task is waiting for user follow-up.",
    ].join(" "),
    async execute(params, context) {
      const root = await bindings.rootThread(params.rootThreadId ?? context.threadId);
      const result = await bindings.execution({ ...params, rootThreadId: root.id });
      const assignment = await assignedTo(result.task.id);
      return `${result.reused ? "Reused" : "Created"} execution task ${result.task.key}, assigned to ${assignment}, with idempotency key ${result.binding.idempotencyKey}.`;
    },
  });
  bb.agents.registerTool({
    name: "bind_execution_owner",
    description: "Bind a direct root owner or dispatch one delegated child owner for an execution task.",
    parameters: z.object({
      rootThreadId: z.string().optional(),
      idempotencyKey: z.string().trim().min(1).max(200),
      mode: z.enum(["direct", "delegated"]),
      prompt: z.string().trim().min(1).optional(),
      title: z.string().trim().min(1).optional(),
      visibility: z.enum(["visible", "hidden"]).optional(),
    }),
    instructions: "Call get_work_context first. Delegated dispatch persists pending state before spawn; if recovery is required, do not retry automatically.",
    async execute(params, context) {
      const root = await bindings.rootThread(params.rootThreadId ?? context.threadId);
      const result = await bindings.owner({ ...params, rootThreadId: root.id });
      return JSON.stringify({ binding: bindings.summarize(result.binding), spawnedThreadId: result.spawnedThreadId });
    },
  });
  bb.agents.registerTool({
    name: "get_sidebar_tasks",
    description: "List the active BB Tasks items and their Human or Agent assignment.",
    parameters: z.object({}).strict(),
    instructions: "Use this when the user asks to check tasks, task assignments, or the task queue. It reads BB Tasks, not a repository TODO file.",
    async execute() {
      if (!(await tasks.available())) throw new Error("The BB Tasks plugin is unavailable.");
      const { tasks: sidebarTasks } = await tasks.sidebar();
      return JSON.stringify({ tasks: sidebarTasks.map(({ key, title, status, priority, assignee, linkedThreadIds }) => ({ key, title, status, priority, assignee, linkedThreadIds })) });
    },
  });
}
