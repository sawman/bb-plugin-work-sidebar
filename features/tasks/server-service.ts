import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "../../contracts.js";
import { projectSidebarTask, summarizeTask } from "./server-model.js";
import { createTasksPluginAdapter, taskThreadIdSchema } from "./server-task-adapter.js";
import { registerTasksTools } from "./server-tool-registration.js";
import {
  createWorkBindingsService,
  publishWorkBindingReady,
  type WorkBindingsState,
} from "./server-work-bindings.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";

export const DURABLE_BOUND_TASK_DETACH_ERROR =
  "This task is part of a durable work binding and cannot be detached from its bound owner.";

function isBoundOwnerTask(
  bindings: WorkBindingsState,
  taskId: string,
  threadId: string,
) {
  return (
    bindings.outcomes.some(
      (binding) =>
        binding.outcomeTaskId === taskId && binding.rootThreadId === threadId,
    ) ||
    bindings.executions.some(
      (binding) =>
        binding.executionTaskId === taskId && binding.ownerThreadId === threadId,
    )
  );
}

export const WORK_AGENT_INSTRUCTIONS = [
  "Use BB Tasks as the source of truth for all work tracking.",
  "When asked to check tasks, use get_sidebar_tasks (or the BB Tasks skill), never a repository TODO file as the task source.",
  "Create or attach the durable top-level outcome before substantive work, and create direct execution tasks for distinct agent work.",
  "Treat Human-assigned tasks as user-owned and do not work them unless the user explicitly delegates them; Agent-assigned tasks are eligible for agent work.",
  "Set assignee to Agent when creating work for yourself, and change it to Human with update_task when explicit user follow-up is required.",
  "Before task creation, dispatch, or status change, call get_work_context at start/resume/after compaction.",
  "It reads durable bindings; no automatic compaction hook exists.",
  "Keep one top-level outcome per root work item, with execution tasks as direct children only.",
  "Bind direct work to the root or delegated work to one spawned child.",
  "Builtin Tasks 0.1.2 cannot preserve root parenting for durable delegation; use bind_execution_owner, or explicitly run bb thread spawn --parent-self --new-environment worktree and then bb tasks attach from the spawned child.",
  "For delegated code edits, bind_execution_owner must explicitly select environment managed-worktree (with an optional baseBranch); choose reuse only when sharing the root checkout is intentional.",
  "Pending/recovery dispatch states require explicit reconciliation; never retry an uncertain spawn automatically.",
  "Task lifecycle is explicit: thread idle/completion never promotes a task.",
  "Move fully validated tasks directly from in_progress to done; use in_review only while a named reviewer or concrete acceptance gate is actually pending.",
  "Use get_task for task detail, update_task for safe task fields or assignment, and comment_task for milestones without falling back to shell commands.",
].join(" ");

type TaskHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "sidebarTasks"
  | "sidebarTaskLinks"
  | "createWorkTask"
  | "ensureOutcomeContext"
  | "createExecutionTask"
  | "bindExecutionOwner"
  | "adoptLegacyOutcome"
  | "updateTaskStatus"
  | "updateTaskAssignee"
  | "createSidebarTask"
  | "deleteSidebarTask"
  | "attachTaskToThread"
  | "detachTaskFromThread"
  | "reorderTask"
>;

export type TasksRegistration = TaskHandlers & Pick<
  ReturnType<typeof createTasksPluginAdapter>,
  "available" | "projects" | "allTasksById" | "readAssignees"
> & Pick<
  ReturnType<typeof createWorkBindingsService>,
  "rootThread" | "descendants" | "summarize" | "links" | "legacy" | "context" | "outcome" | "execution" | "owner"
> & {
  projectTaskSummary(
    task: Parameters<typeof summarizeTask>[0],
    projectName: string,
  ): ReturnType<typeof summarizeTask>;
  bindings(): ReturnType<ReturnType<typeof createWorkBindingsService>["read"]>;
  registerTools(): void;
};

/** Task RPC handler composition over narrow plugin, binding, and tool services. */
export function createTasksService(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
): TasksRegistration {
  const adapter = createTasksPluginAdapter(bb);
  const bindings = createWorkBindingsService(bb, adapter, lifecycle);
  const taskWithProject = async (task: Parameters<typeof summarizeTask>[0]) => {
    const projects = await adapter.projects();
    return summarizeTask(task, projects.find((project) => project.id === task.projectId)?.name ?? "Work");
  };
  const handlers: TaskHandlers = {
    async sidebarTasks() {
      try {
        if (!(await adapter.available())) return { available: false, tasks: [], projects: [], error: null };
        return { available: true, ...(await adapter.sidebar()), error: null };
      } catch (error) {
        return { available: false, tasks: [], projects: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarTaskLinks() {
      try {
        if (!(await adapter.available())) return { available: false, links: {}, error: null };
        return { available: true, links: await bindings.links(), error: null };
      } catch (error) {
        return { available: false, links: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async createWorkTask(input) {
      if (input.parentTaskId) throw new Error("Work Sidebar outcomes must be top-level; create execution tasks through createExecutionTask instead");
      const root = await bindings.rootThread(input.threadId);
      const result = await bindings.outcome({ ...input, rootThreadId: root.id });
      return { task: await taskWithProject(result.task) };
    },
    async ensureOutcomeContext(input) {
      const result = await bindings.outcome(input);
      return { task: await taskWithProject(result.task), binding: bindings.summarize(result.binding) };
    },
    async createExecutionTask(input) {
      const result = await bindings.execution(input);
      const assignee = (await adapter.readAssignees())[result.task.id] ?? "human";
      return { task: { ...(await taskWithProject(result.task)), assignee }, binding: bindings.summarize(result.binding), reused: result.reused };
    },
    async bindExecutionOwner(input) {
      const result = await bindings.owner(input);
      return { binding: bindings.summarize(result.binding), spawnedThreadId: result.spawnedThreadId };
    },
    async adoptLegacyOutcome({ rootThreadId, taskId }) {
      const root = await bindings.rootThread(rootThreadId);
      const snapshot = await bindings.context(root.id, root.projectId);
      const saved = snapshot.bindings;
      if (saved.outcomes.some((binding) => binding.rootThreadId === root.id)) throw new Error("A durable outcome binding already exists for this root thread");
      const candidate = snapshot.legacy;
      if (candidate.state !== "adoptable" || candidate.taskIds[0] !== taskId) throw new Error(candidate.message ?? "This legacy task cannot be adopted unambiguously");
      const task = (await adapter.allTasksById()).get(taskId);
      if (!task || task.parentTaskId !== null) throw new Error("Only an unambiguous top-level legacy task can be adopted as an outcome");
      const now = new Date().toISOString();
      const binding = { kind: "outcome" as const, rootThreadId: root.id, outcomeTaskId: task.id, taskProjectId: task.projectId, createdAt: now, updatedAt: now };
      await bindings.write({ ...saved, outcomes: [...saved.outcomes, binding] });
      bindings.invalidateLegacy(root.id, root.projectId);
      publishWorkBindingReady(bb.realtime, root.id);
      return { task: await taskWithProject(task), binding: bindings.summarize(binding) };
    },
    async updateTaskStatus({ taskId, status }) { return adapter.update(taskId, status); },
    async updateTaskAssignee({ taskId, assignee }) { return adapter.writeAssignee(taskId, assignee); },
    async createSidebarTask({ projectId, title, assignee }) { return adapter.createSidebar(projectId, title, assignee); },
    async deleteSidebarTask({ taskId }) {
      const saved = await bindings.read();
      if (saved.outcomes.some((binding) => binding.outcomeTaskId === taskId) || saved.executions.some((binding) => binding.executionTaskId === taskId)) {
        throw new Error("This task is part of a durable work binding and cannot be deleted from the sidebar.");
      }
      return adapter.deleteSidebar(taskId);
    },
    async attachTaskToThread({ taskId, threadId }) {
      const root = await bindings.rootThread(threadId);
      const result = await adapter.call(
        "taskThreadsAttach",
        { taskId, threadId },
        z.object({ threadId: taskThreadIdSchema }),
      );
      bindings.invalidateLegacy(root.id, root.projectId);
      publishWorkBindingReady(bb.realtime, root.id);
      return result;
    },
    async detachTaskFromThread({ taskId, threadId }) {
      if (isBoundOwnerTask(await bindings.read(), taskId, threadId))
        throw new Error(DURABLE_BOUND_TASK_DETACH_ERROR);
      const root = await bindings.rootThread(threadId);
      const result = await adapter.call(
        "taskThreadsDetach",
        { taskId, threadId },
        z.object({ threadId: taskThreadIdSchema }),
      );
      bindings.invalidateLegacy(root.id, root.projectId);
      publishWorkBindingReady(bb.realtime, root.id);
      return result;
    },
    async reorderTask({ taskId, beforeTaskId, afterTaskId }) { return adapter.reorder(taskId, beforeTaskId, afterTaskId); },
  };
  return {
    ...handlers,
    available: adapter.available,
    projects: adapter.projects,
    allTasksById: adapter.allTasksById,
    readAssignees: adapter.readAssignees,
    projectTaskSummary: summarizeTask,
    bindings: bindings.read,
    rootThread: bindings.rootThread,
    descendants: bindings.descendants,
    summarize: bindings.summarize,
    links: bindings.links,
    legacy: bindings.legacy,
    context: bindings.context,
    outcome: bindings.outcome,
    execution: bindings.execution,
    owner: bindings.owner,
    registerTools: () => registerTasksTools(bb, adapter, bindings),
  };
}
