import type {
  SidebarTask,
  TaskSummary,
  ThreadTaskLink,
} from "../../work-model";

export type TaskFact = Omit<SidebarTask, "linkedThreadIds">;
export type TaskFactDirectory = Readonly<{
  projectId: string | null;
  facts: Record<string, TaskFact>;
  authorityByTaskId?: Record<string, number>;
}>;
export type TaskRelationship = Readonly<{
  taskId: string;
  linkedThreadIds: string[];
}>;
export type TaskLinkReference = Omit<ThreadTaskLink, "task"> & {
  taskId: string;
};
export type TaskLinkReferences = Readonly<{
  available: boolean;
  links: Record<string, TaskLinkReference[]>;
  error: string | null;
}>;

type TaskFactInput = TaskSummary & {
  position?: number;
  assignee?: "agent" | "human";
  linkedThreadIds?: readonly string[];
  /** Normalization-only source rank; never retained in a TaskFact. */
  taskFactAuthority?: number;
};

type SidebarTaskReferences = Readonly<{
  available: boolean;
  taskIds: string[];
  projects: Array<{ id: string; name: string }>;
  error: string | null;
}>;

export const MAX_TASK_FACTS_PER_PROJECT = 1_000;
const TASK_FACT_AUTHORITY = {
  links: 1,
  sidebar: 2,
  workOutcome: 3,
} as const;

function timestamp(value: string | undefined): number {
  if (!value) return -Infinity;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : -Infinity;
}

function mergeTaskFact(
  previous: TaskFact | undefined,
  incoming: TaskFactInput,
  preferIncoming: boolean,
): TaskFact {
  if (previous && !preferIncoming) {
    return {
      ...previous,
      ...(previous.position === undefined && incoming.position !== undefined
        ? { position: incoming.position }
        : {}),
    };
  }
  return {
    id: incoming.id,
    projectId: incoming.projectId,
    projectName: incoming.projectName,
    key: incoming.key,
    title: incoming.title,
    status: incoming.status,
    priority: incoming.priority,
    dueDate: incoming.dueDate,
    parentTaskId: incoming.parentTaskId,
    ...(incoming.updatedAt === undefined
      ? previous?.updatedAt === undefined
        ? {}
        : { updatedAt: previous.updatedAt }
      : { updatedAt: incoming.updatedAt }),
    ...(incoming.position === undefined
      ? previous?.position === undefined
        ? {}
        : { position: previous.position }
      : { position: incoming.position }),
    assignee: incoming.assignee ?? previous?.assignee ?? "human",
  };
}

/** Merge facts into one bounded project directory without stale-source rollback. */
export function mergeTaskFacts(
  previous: TaskFactDirectory | undefined,
  projectId: string | null,
  incoming: readonly TaskFactInput[],
): TaskFactDirectory {
  const facts: Record<string, TaskFact> =
    previous?.projectId === projectId ? { ...previous.facts } : {};
  const authorityByTaskId =
    previous?.projectId === projectId
      ? { ...previous.authorityByTaskId }
      : {};
  for (const input of incoming) {
    const current = facts[input.id];
    const incomingTimestamp = timestamp(input.updatedAt);
    const currentTimestamp = timestamp(current?.updatedAt);
    const incomingAuthority = input.taskFactAuthority ?? 0;
    const currentAuthority = authorityByTaskId[input.id] ?? 0;
    // Newer durable revisions always win. For equal revisions, the Work
    // binding response is authoritative over the sidebar list, which is in
    // turn authoritative over its compact thread-link summaries.
    const preferIncoming =
      !current ||
      incomingTimestamp > currentTimestamp ||
      (incomingTimestamp === currentTimestamp &&
        incomingAuthority >= currentAuthority);
    delete facts[input.id];
    facts[input.id] = mergeTaskFact(current, input, preferIncoming);
    if (preferIncoming) authorityByTaskId[input.id] = incomingAuthority;
  }
  for (const taskId of Object.keys(facts).slice(0, -MAX_TASK_FACTS_PER_PROJECT)) {
    delete facts[taskId];
    delete authorityByTaskId[taskId];
  }
  return { projectId, facts, authorityByTaskId };
}

export function adaptSidebarTaskResponse(
  projectId: string | null,
  response: {
    available: boolean;
    tasks: readonly TaskFactInput[];
    projects: Array<{ id: string; name: string }>;
    error: string | null;
  },
) {
  return {
    facts: response.tasks.map((task) => ({
      ...task,
      taskFactAuthority: TASK_FACT_AUTHORITY.sidebar,
    })),
    references: {
      available: response.available,
      taskIds: response.tasks.map((task) => task.id),
      projects: response.projects,
      error: response.error,
    } satisfies SidebarTaskReferences,
    relationships: response.tasks.map((task) => ({
      taskId: task.id,
      linkedThreadIds: [...(task.linkedThreadIds ?? [])],
    })),
    projectId,
  };
}

export function resolveSidebarTasks(
  references: SidebarTaskReferences,
  relationships: readonly TaskRelationship[],
  directory: TaskFactDirectory | undefined,
) {
  const relationshipsByTask = new Map(
    relationships.map((relationship) => [relationship.taskId, relationship]),
  );
  return {
    available: references.available,
    tasks: references.taskIds.flatMap((taskId): SidebarTask[] => {
      const fact = directory?.facts[taskId];
      if (!fact) return [];
      return [{
        ...fact,
        linkedThreadIds:
          relationshipsByTask.get(taskId)?.linkedThreadIds ?? [],
      }];
    }),
    projects: references.projects,
    error: references.error,
  };
}

export function adaptTaskLinkResponse(response: {
  available: boolean;
  links: Record<string, Array<ThreadTaskLink>>;
  error: string | null;
}) {
  const facts: TaskFactInput[] = [];
  const links = Object.fromEntries(
    Object.entries(response.links).map(([threadId, rows]) => [
      threadId,
      rows.map(({ task, ...relationship }) => {
        facts.push({
          ...task,
          taskFactAuthority: TASK_FACT_AUTHORITY.links,
        });
        return { ...relationship, taskId: task.id };
      }),
    ]),
  );
  return {
    facts,
    references: {
      available: response.available,
      links,
      error: response.error,
    } satisfies TaskLinkReferences,
  };
}

export function resolveTaskLinks(
  references: TaskLinkReferences,
  directory: TaskFactDirectory | undefined,
) {
  return {
    available: references.available,
    links: Object.fromEntries(
      Object.entries(references.links).map(([threadId, rows]) => [
        threadId,
        rows.flatMap(({ taskId, ...relationship }): ThreadTaskLink[] => {
          const task = directory?.facts[taskId];
          return task ? [{ ...relationship, task }] : [];
        }),
      ]),
    ),
    error: references.error,
  };
}

export function adaptWorkOutcomeResponse<
  Binding,
  Legacy,
>(response: {
  rootThreadId: string;
  tasksAvailable: boolean;
  outcome: TaskFactInput | null;
  executionTasks: TaskFactInput[];
  bindings: Binding[];
  legacy: Legacy;
}) {
  return {
    facts: [
      ...(response.outcome ? [response.outcome] : []),
      ...response.executionTasks,
    ].map((task) => ({
      ...task,
      taskFactAuthority: TASK_FACT_AUTHORITY.workOutcome,
    })),
    references: {
      rootThreadId: response.rootThreadId,
      tasksAvailable: response.tasksAvailable,
      outcomeTaskId: response.outcome?.id ?? null,
      executionTaskIds: response.executionTasks.map((task) => task.id),
      bindings: response.bindings,
      legacy: response.legacy,
    },
  };
}

export function resolveWorkOutcome<Binding, Legacy>(
  references: {
    rootThreadId: string;
    tasksAvailable: boolean;
    outcomeTaskId: string | null;
    executionTaskIds: string[];
    bindings: Binding[];
    legacy: Legacy;
  },
  directory: TaskFactDirectory | undefined,
) {
  return {
    rootThreadId: references.rootThreadId,
    tasksAvailable: references.tasksAvailable,
    outcome: references.outcomeTaskId
      ? directory?.facts[references.outcomeTaskId] ?? null
      : null,
    executionTasks: references.executionTaskIds.flatMap((taskId) => {
      const fact = directory?.facts[taskId];
      return fact ? [fact] : [];
    }),
    bindings: references.bindings,
    legacy: references.legacy,
  };
}
