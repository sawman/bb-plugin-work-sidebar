import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { WorkContextCompositionDependencies } from "../../shared/server-composition-dependencies.js";
import { createWorkContextReadService } from "./server-reads.js";
import { createBackgroundJobsReadService } from "./background-jobs-server.js";
import { projectWorkBindingOwner } from "./server-owner-projection.js";
import { createWorkItemQueueService, normalizeWorkItemQueue, WORK_ITEM_QUEUE_KEY } from "./work-item-queue-server.js";
import { projectLatestActivity } from "./latest-activity.js";

type WorkContextHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getWorkContext"
  | "getWorkStatus"
  | "getWorkOutcome"
  | "getWorkGoal"
  | "getWorkPlan"
  | "getWorkItemQueue"
  | "saveWorkItemQueue"
  | "moveWorkItemToExecution"
  | "getWorkProviderStatus"
  | "getLatestActivity"
  | "getWorkBackgroundJobs"
>;

const PROVIDER_STATUS_URLS: Readonly<Record<string, string>> = {
  codex: "https://status.openai.com/",
  "claude-code": "https://status.claude.com/",
  "acp-cursor": "https://status.cursor.com/",
};


const emptyLegacyContext = () => ({
  state: "none" as const,
  taskIds: [],
  message: null,
});


/** Work card and activity RPC handlers belong to the Work Context slice. */
export function createWorkContextRegistration(
  dependencies: WorkContextCompositionDependencies,
): WorkContextHandlers {
  const { bb, tasks } = dependencies;
  const queueService = createWorkItemQueueService({
    get: () => bb.storage.kv.get<unknown>(WORK_ITEM_QUEUE_KEY),
    set: (value) => bb.storage.kv.set(WORK_ITEM_QUEUE_KEY, value),
    publish: (rootThreadId) => {
      bb.realtime.publish("work-sidebar:changed", { family: "work", rootThreadId });
      bb.realtime.publish("work-sidebar:changed", { family: "tasks", threadId: rootThreadId });
    },
    ensureOutcome: tasks.ensureOutcomeContext,
    createExecution: tasks.createExecutionTask,
  });
  const backgroundJobs = createBackgroundJobsReadService({
    timeline: (input) => bb.sdk.threads.timeline(input),
  });
  const readStatus = async (threadId: string) => {
    const [thread, children, root] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      tasks.descendants(threadId),
      tasks.rootThread(threadId),
    ]);
    return {
      rootThreadId: root.id,
      currentThread: {
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
        status: thread.status,
        runtimeStatus: thread.runtime.displayStatus,
        providerId: thread.providerId,
      },
      children: children.map(({ thread: child, depth }) => ({
        id: child.id,
        title: child.title ?? child.titleFallback ?? "Untitled agent",
        depth,
        status: child.status,
        runtimeStatus: child.runtime.displayStatus,
        providerId: child.providerId,
        isArchived: child.archivedAt !== null,
        task: null,
      })),
    };
  };
  const readOutcome = async (threadId: string) => {
    const root = await tasks.rootThread(threadId);
    if (!(await tasks.available())) {
      return {
        rootThreadId: root.id,
        tasksAvailable: false,
        outcome: null,
        executionTasks: [],
        bindings: [],
        legacy: emptyLegacyContext(),
      };
    }
    const snapshot = await tasks.context(root.id, root.projectId);
    const [byId, projects, assignees, descendants] = await Promise.all([
      tasks.allTasksById(),
      tasks.projects(),
      tasks.readAssignees(),
      tasks.descendants(root.id),
    ]);
    const saved = snapshot.bindings;
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const outcomeBinding = saved.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
    const executions = saved.executions.filter((binding) => binding.rootThreadId === root.id);
    const threadById = new Map([root, ...descendants.map(({ thread }) => thread)].map((thread) => [thread.id, thread]));
    const outcome = outcomeBinding ? byId.get(outcomeBinding.outcomeTaskId) ?? null : null;
    return {
      rootThreadId: root.id,
      tasksAvailable: true,
      outcome: outcome ? {
        ...outcome,
        projectName: names.get(outcome.projectId) ?? "Work",
      } : null,
      executionTasks: executions.flatMap((binding) => {
        const task = byId.get(binding.executionTaskId);
        return task ? [{ ...tasks.projectTaskSummary(task, names.get(task.projectId) ?? "Work"), assignee: assignees[task.id] ?? "human" }] : [];
      }),
      bindings: [
        ...(outcomeBinding ? [projectWorkBindingOwner(tasks.summarize(outcomeBinding), threadById)] : []),
        ...executions.map((binding) => projectWorkBindingOwner(tasks.summarize(binding), threadById)),
      ],
      legacy: snapshot.legacy,
    };
  };
  const readGoal = async (threadId: string) => {
    const timeline = await bb.sdk.threads.timeline({ threadId });
    return timeline.goal ? {
      objective: timeline.goal.objective,
      status: timeline.goal.status,
      tokensUsed: timeline.goal.tokensUsed,
      tokenBudget: timeline.goal.tokenBudget,
      timeUsedSeconds: timeline.goal.timeUsedSeconds,
    } : null;
  };
  const readPlan = async (threadId: string) => {
    const timeline = await bb.sdk.threads.timeline({ threadId });
    return { items: timeline.pendingTodos?.items ?? [] };
  };
  const cards = createWorkContextReadService({ readStatus, readOutcome, readGoal, readPlan });
  const getContext = async (threadId: string) => {
    const [thread, available, timeline, children, root] = await Promise.all([
      bb.sdk.threads.get({ threadId }),
      tasks.available(),
      bb.sdk.threads.timeline({ threadId }),
      tasks.descendants(threadId),
      tasks.rootThread(threadId),
    ]);
    const snapshot = available
      ? await tasks.context(root.id, root.projectId)
      : { bindings: await tasks.bindings(), legacy: emptyLegacyContext() };
    const saved = snapshot.bindings;
    const links = available ? await tasks.links() : {};
    const outcomeBinding = saved.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
    const [byId, projects] = available
      ? await Promise.all([tasks.allTasksById(), tasks.projects()])
      : [new Map(), []];
    const assignees: Record<string, "agent" | "human"> = available
      ? await tasks.readAssignees()
      : {};
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const outcome = outcomeBinding ? byId.get(outcomeBinding.outcomeTaskId) ?? null : null;
    const executions = saved.executions.filter((binding) => binding.rootThreadId === root.id);
    const executionTasks = executions.flatMap((binding) => {
      const task = byId.get(binding.executionTaskId);
      return task ? [{ ...tasks.projectTaskSummary(task, names.get(task.projectId) ?? "Work"), assignee: assignees[task.id] ?? "human" }] : [];
    });
    return {
      rootThreadId: root.id,
      tasksAvailable: available,
      currentThread: {
        title: thread.title ?? thread.titleFallback ?? "Untitled thread",
        status: thread.status,
        runtimeStatus: thread.runtime.displayStatus,
        providerId: thread.providerId,
      },
      tasks: outcome ? [{ ...outcome, projectName: names.get(outcome.projectId) ?? "Work" }] : [],
      subtasks: executionTasks,
      outcome: outcome ? { ...outcome, projectName: names.get(outcome.projectId) ?? "Work" } : null,
      executionTasks,
      bindings: [
        ...(outcomeBinding ? [tasks.summarize(outcomeBinding)] : []),
        ...executions.map(tasks.summarize),
      ],
      legacy: snapshot.legacy,
      goal: timeline.goal ? {
        objective: timeline.goal.objective,
        status: timeline.goal.status,
        tokensUsed: timeline.goal.tokensUsed,
        tokenBudget: timeline.goal.tokenBudget,
        timeUsedSeconds: timeline.goal.timeUsedSeconds,
      } : null,
      todos: timeline.pendingTodos?.items ?? [],
      children: children.map(({ thread: child, depth }) => ({
        id: child.id,
        title: child.title ?? child.titleFallback ?? "Untitled agent",
        depth,
        status: child.status,
        runtimeStatus: child.runtime.displayStatus,
        providerId: child.providerId,
        isArchived: child.archivedAt !== null,
        task: links[child.id]?.[0] ? {
          key: links[child.id][0].task.key,
          status: links[child.id][0].task.status,
          liveStatus: links[child.id][0].liveStatus,
        } : null,
      })),
    };
  };
  return {
    async getWorkItemQueue({ threadId }) {
      const root = await tasks.rootThread(threadId);
      return { rootThreadId: root.id, ...(await queueService.read(root.id)) };
    },
    async saveWorkItemQueue({ threadId, queue }) {
      const root = await tasks.rootThread(threadId);
      return {
        rootThreadId: root.id,
        ...(await queueService.write(root.id, normalizeWorkItemQueue(queue))),
      };
    },
    async moveWorkItemToExecution({ threadId, reference, title, description }) {
      if (!(await tasks.available())) throw new Error("BB Tasks are unavailable.");
      const root = await tasks.rootThread(threadId);
      return queueService.moveToExecution(root.id, normalizeWorkItemQueue({ current: reference, backlog: [] }).current!, title, description);
    },
    async getWorkContext({ threadId }) { return getContext(threadId); },
    async getWorkStatus({ threadId }) { return cards.status(threadId); },
    async getWorkOutcome({ threadId }) { return cards.outcome(threadId); },
    async getWorkGoal({ threadId }) { return cards.goal(threadId); },
    async getWorkPlan({ threadId }) { return cards.plan(threadId); },
    async getWorkBackgroundJobs({ threadId }) { return backgroundJobs.read(threadId); },
    async getWorkProviderStatus({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      try {
        const states = await bb.sdk.system.providerStates(
          thread.environmentId ? { environmentId: thread.environmentId } : {},
        );
        const provider = states.providers.find((candidate) => candidate.providerId === thread.providerId);
        if (!provider) {
          return {
            tone: "amber" as const,
            providerId: thread.providerId,
            providerName: thread.providerId,
            statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null,
            status: "unavailable" as const,
            message: "Provider health is not available from this host.",
          };
        }
        const tone = provider.status === "ready" ? "green" as const : provider.status === "unknown" ? "amber" as const : "red" as const;
        return {
          tone,
          providerId: thread.providerId,
          providerName: provider.displayName,
          statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null,
          status: provider.status,
          message: provider.statusMessage,
        };
      } catch (error) {
        return {
          tone: "amber" as const,
          providerId: thread.providerId,
          providerName: thread.providerId,
          statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null,
          status: "unknown" as const,
          message: error instanceof Error ? error.message : "Provider health could not be checked.",
        };
      }
    },
    async getLatestActivity({ threadId }) {
      const [thread, timeline, output] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        bb.sdk.threads.timeline({ threadId }),
        bb.sdk.threads.output({ threadId }),
      ]);
      return {
        currentThread: { status: thread.status, runtimeStatus: thread.runtime.displayStatus },
        ...projectLatestActivity(timeline.rows, output.output, thread.status === "active" || thread.status === "starting"),
      };
    },
  };
}
