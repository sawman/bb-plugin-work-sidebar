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
  const namedTask = async (task: Parameters<typeof summarizeTask>[0]) => {
    const projects = await tasks.projects();
    return summarizeTask(task, projects.find((project) => project.id === task.projectId)?.name ?? "Work");
  };
  bb.agents.registerTool({
    name: "create_work_task",
    description: "Ensure the one top-level outcome task for the current root work item.",
    parameters: z.object({ title: z.string().trim().min(1), description: z.string(), taskProjectId: z.string().nullable().optional() }),
    instructions: "Call get_work_context first. Outcomes are top-level only; execution units are direct children created with create_execution_task.",
    async execute(params, context) {
      const root = await bindings.rootThread(context.threadId);
      const result = await bindings.outcome({ rootThreadId: root.id, title: params.title, description: params.description, taskProjectId: params.taskProjectId });
      const task = await namedTask(result.task);
      return `Work is tracked as ${task.key}: ${task.title}. Work through this task, record meaningful milestones with bb tasks comment, and set it to in_review after validation.`;
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
    description: "Create or reuse one direct execution subtask using a stable idempotency key.",
    parameters: z.object({ rootThreadId: z.string().optional(), title: z.string().trim().min(1), description: z.string().default(""), idempotencyKey: z.string().trim().min(1).max(200) }),
    instructions: "Call get_work_context first. This creates only a direct child of the durable top-level outcome; never create nested Tasks subtasks.",
    async execute(params, context) {
      const root = await bindings.rootThread(params.rootThreadId ?? context.threadId);
      const result = await bindings.execution({ ...params, rootThreadId: root.id });
      return `${result.reused ? "Reused" : "Created"} execution task ${result.task.key} with idempotency key ${result.binding.idempotencyKey}.`;
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
