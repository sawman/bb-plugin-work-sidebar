import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { WorkContextCompositionDependencies } from "../../shared/server-composition-dependencies.js";
import { createWorkContextReadService } from "./server-reads.js";

type WorkContextHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getWorkContext"
  | "getWorkStatus"
  | "getWorkOutcome"
  | "getWorkGoal"
  | "getWorkPlan"
  | "getWorkProviderStatus"
  | "getLatestActivity"
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function latestActivity(rows: readonly unknown[], latestAssistant: string | null, hasCurrentTurn: boolean) {
  const flattened: unknown[] = [];
  const visit = (items: readonly unknown[]) => items.forEach((item) => {
    flattened.push(item);
    if (isRecord(item) && Array.isArray(item.children)) visit(item.children);
  });
  visit(rows);
  type ActivityKind = "assistant" | "user" | "command" | "activity";
  type Activity = { text: string; kind: ActivityKind };
  const activity: Activity[] = [];
  for (const row of flattened) {
    if (!isRecord(row)) continue;
    if (row.kind === "conversation" && typeof row.text === "string" && row.text.trim()) {
      activity.push({ text: row.text.trim(), kind: row.role === "assistant" ? "assistant" : "user" });
    } else if (row.kind === "work" && row.workKind === "command" && typeof row.command === "string" && row.command.trim()) {
      activity.push({ text: row.command.trim(), kind: "command" });
    } else if (typeof row.text === "string" && row.text.trim()) {
      activity.push({ text: row.text.trim(), kind: "activity" });
    }
  }
  let lastUser: Activity | undefined;
  let lastAssistant: Activity | undefined;
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    if (activity[index]?.kind === "user") {
      lastUser = activity[index];
      break;
    }
  }
  for (let index = activity.length - 1; index >= 0; index -= 1) {
    if (activity[index]?.kind === "assistant") {
      lastAssistant = activity[index];
      break;
    }
  }
  const latest = latestAssistant?.trim()
    ? { text: latestAssistant.trim().slice(0, 360), kind: "assistant" as const }
    : lastAssistant ? { text: lastAssistant.text.slice(0, 360), kind: "assistant" as const } : null;
  return {
    latest,
    lastUser: lastUser ? { text: lastUser.text.slice(0, 360), kind: "user" as const } : null,
    current: hasCurrentTurn && lastUser
      ? { text: lastUser.text.slice(0, 360), kind: "user" as const }
      : null,
  };
}

/** Work card and activity RPC handlers belong to the Work Context slice. */
export function createWorkContextRegistration(
  dependencies: WorkContextCompositionDependencies,
): WorkContextHandlers {
  const { bb, tasks } = dependencies;
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
    const [byId, projects] = await Promise.all([
      tasks.allTasksById(),
      tasks.projects(),
    ]);
    const saved = snapshot.bindings;
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const outcomeBinding = saved.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
    const executions = saved.executions.filter((binding) => binding.rootThreadId === root.id);
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
        return task ? [{ ...task, projectName: names.get(task.projectId) ?? "Work" }] : [];
      }),
      bindings: [
        ...(outcomeBinding ? [tasks.summarize(outcomeBinding)] : []),
        ...executions.map(tasks.summarize),
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
    const names = new Map(projects.map((project) => [project.id, project.name]));
    const outcome = outcomeBinding ? byId.get(outcomeBinding.outcomeTaskId) ?? null : null;
    const executions = saved.executions.filter((binding) => binding.rootThreadId === root.id);
    const executionTasks = executions.flatMap((binding) => {
      const task = byId.get(binding.executionTaskId);
      return task ? [{ ...task, projectName: names.get(task.projectId) ?? "Work" }] : [];
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
    async getWorkContext({ threadId }) { return getContext(threadId); },
    async getWorkStatus({ threadId }) { return cards.status(threadId); },
    async getWorkOutcome({ threadId }) { return cards.outcome(threadId); },
    async getWorkGoal({ threadId }) { return cards.goal(threadId); },
    async getWorkPlan({ threadId }) { return cards.plan(threadId); },
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
        ...latestActivity(timeline.rows, output.output, thread.status === "active" || thread.status === "starting"),
      };
    },
  };
}
