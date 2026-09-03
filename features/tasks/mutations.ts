import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { reorderTaskSiblings, type SidebarTask } from "../../work-model";
import { queryKeys, workOutcomeQueryRoot } from "../../query-runtime";
import type { TaskFactDirectory } from "./facts";

type TaskListReferences = { taskIds: string[] };
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type TaskScope = "list" | "links" | "outcome";
type TaskInvalidation = {
  scope: TaskScope;
  projectId?: string | null;
};

export const taskOptimisticMutationKey = ["tasks", "optimistic"] as const;
const taskAssignmentMutationScope = { id: "tasks-assignment" };
const taskReorderMutationScope = { id: "tasks-reorder" };

const invalidationState = new WeakMap<
  QueryClient,
  { deferred: Map<string, TaskInvalidation> }
>();

function invalidationId({ scope, projectId }: TaskInvalidation) {
  const projectScope =
    scope === "outcome" || projectId === undefined
      ? "*"
      : (projectId ?? "all");
  return `${scope}:${projectScope}`;
}

function stateFor(queryClient: QueryClient) {
  let state = invalidationState.get(queryClient);
  if (!state) {
    state = { deferred: new Map() };
    invalidationState.set(queryClient, state);
  }
  return state;
}

function hasOtherOptimisticMutation(queryClient: QueryClient, settlingOptimistic: boolean) {
  return queryClient.isMutating({ mutationKey: taskOptimisticMutationKey }) > (settlingOptimistic ? 1 : 0);
}

export function invalidateTaskQueries(
  queryClient: QueryClient,
  scopes: readonly TaskScope[],
  settlingOptimistic = false,
  projectId?: string | null,
) {
  const state = stateFor(queryClient);
  const requested = scopes.map((scope): TaskInvalidation => ({
    scope,
    ...(scope === "outcome" || projectId === undefined ? {} : { projectId }),
  }));
  if (hasOtherOptimisticMutation(queryClient, settlingOptimistic)) {
    requested.forEach((invalidation) =>
      state.deferred.set(invalidationId(invalidation), invalidation),
    );
    return Promise.resolve();
  }
  const finalInvalidations = new Map(state.deferred);
  requested.forEach((invalidation) =>
    finalInvalidations.set(invalidationId(invalidation), invalidation),
  );
  state.deferred.clear();
  for (const scope of ["list", "links"] as const) {
    const rootId = invalidationId({ scope });
    if (!finalInvalidations.has(rootId)) continue;
    for (const [id, invalidation] of finalInvalidations)
      if (invalidation.scope === scope && id !== rootId)
        finalInvalidations.delete(id);
  }
  return Promise.all(
    [...finalInvalidations.values()].map(
      ({ scope, projectId: scopeProjectId }) =>
        queryClient.invalidateQueries({
          queryKey:
            scope === "list"
              ? scopeProjectId === undefined
                ? queryKeys.sidebar.tasks.list()
                : queryKeys.sidebar.tasks.list(scopeProjectId)
              : scope === "links"
                ? scopeProjectId === undefined
                  ? queryKeys.sidebar.tasks.links()
                  : queryKeys.sidebar.tasks.links(scopeProjectId)
                : workOutcomeQueryRoot(),
        }),
    ),
  );
}

export const taskMutationPlan = {
  create: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list", "links"] },
  delete: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list", "links"] },
  attach: { optimistic: false, rollback: false, cancel: ["list", "links"], invalidate: ["list", "links"] },
  detach: { optimistic: false, rollback: false, cancel: ["list", "links"], invalidate: ["list", "links"] },
  status: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list", "outcome"] },
  assignment: { optimistic: true, rollback: true, cancel: ["list"], invalidate: ["list", "outcome"] },
  reorder: { optimistic: true, rollback: true, cancel: ["list"], invalidate: ["list"] },
} as const satisfies Record<string, { optimistic: boolean; rollback: boolean; cancel: readonly TaskScope[]; invalidate: readonly TaskScope[] }>;

export function useTasksMutations(rpc: Rpc, projectId: string | null = null) {
  const queryClient = useQueryClient();
  const key = (scope: TaskScope) =>
    scope === "list"
      ? queryKeys.sidebar.tasks.list(projectId)
      : scope === "links"
        ? queryKeys.sidebar.tasks.links(projectId)
        : workOutcomeQueryRoot();
  const cancel = async (scopes: readonly TaskScope[]) => Promise.all(scopes.map((scope) => queryClient.cancelQueries({ queryKey: key(scope) })));
  const settle = (scopes: readonly TaskScope[], settlingOptimistic = false) => invalidateTaskQueries(queryClient, scopes, settlingOptimistic, projectId);
  const factKey = queryKeys.sidebar.tasks.facts(projectId);
  const snapshot = () => queryClient.getQueryData<TaskFactDirectory>(factKey);
  const listedTaskIds = () =>
    queryClient.getQueryData<TaskListReferences>(key("list"))?.taskIds ?? [];
  const patchFact = (
    taskId: string,
    update: (
      task: TaskFactDirectory["facts"][string],
    ) => TaskFactDirectory["facts"][string],
  ) => {
    queryClient.setQueryData<TaskFactDirectory>(factKey, (current) => {
      const task = current?.facts[taskId];
      if (!current || !task) return current;
      return {
        ...current,
        facts: { ...current.facts, [taskId]: update(task) },
      };
    });
  };
  const rollbackAssignment = (
    taskId: string,
    assignee: SidebarTask["assignee"] | undefined,
  ) => {
    if (!assignee) return;
    patchFact(taskId, (task) => ({ ...task, assignee }));
  };
  const rollbackReorder = (positions: ReadonlyMap<string, number | undefined>) => {
    for (const [taskId, position] of positions)
      patchFact(taskId, (task) => ({ ...task, position }));
  };

  const create = useMutation({
    mutationFn: (input: { projectId: string; title: string; assignee: SidebarTask["assignee"] }) => rpc.call("createSidebarTask", input),
    onMutate: () => cancel(taskMutationPlan.create.cancel),
    onSettled: () => settle(taskMutationPlan.create.invalidate),
  });
  const remove = useMutation({
    mutationFn: async (input: { taskId: string }) => {
      const result = await rpc.call("deleteSidebarTask", input);
      if (!result.deleted) throw new Error("Task was not found.");
      return result;
    },
    onMutate: () => cancel(taskMutationPlan.delete.cancel),
    onSettled: () => settle(taskMutationPlan.delete.invalidate),
  });
  const attachment = useMutation({
    mutationFn: ({ taskId, threadId, attached }: { taskId: string; threadId: string; attached: boolean }) => rpc.call(attached ? "attachTaskToThread" : "detachTaskFromThread", { taskId, threadId }),
    onMutate: ({ attached }) => cancel(attached ? taskMutationPlan.attach.cancel : taskMutationPlan.detach.cancel),
    onSettled: (_data, _error, { attached }) => settle(attached ? taskMutationPlan.attach.invalidate : taskMutationPlan.detach.invalidate),
  });
  const status = useMutation({
    mutationFn: (input: { taskId: string; status: SidebarTask["status"] }) => rpc.call("updateTaskStatus", input),
    onMutate: () => cancel(taskMutationPlan.status.cancel),
    onSettled: () => settle(taskMutationPlan.status.invalidate),
  });
  const assignment = useMutation({
    mutationKey: taskOptimisticMutationKey,
    scope: taskAssignmentMutationScope,
    mutationFn: (input: { taskId: string; assignee: SidebarTask["assignee"] }) => rpc.call("updateTaskAssignee", input),
    onMutate: async ({ taskId, assignee }) => {
      await cancel(taskMutationPlan.assignment.cancel);
      const previous = snapshot();
      const previousAssignee = previous?.facts[taskId]?.assignee;
      patchFact(taskId, (task) => ({ ...task, assignee }));
      return { previousAssignee };
    },
    onError: (_error, { taskId }, context) => {
      rollbackAssignment(taskId, context?.previousAssignee);
    },
    onSettled: () => settle(taskMutationPlan.assignment.invalidate, true),
  });
  const reorder = useMutation({
    mutationKey: taskOptimisticMutationKey,
    scope: taskReorderMutationScope,
    mutationFn: (input: { taskId: string; beforeTaskId: string | null; afterTaskId: string | null }) => rpc.call("reorderTask", input),
    onMutate: async ({ taskId, beforeTaskId, afterTaskId }) => {
      await cancel(taskMutationPlan.reorder.cancel);
      const previous = snapshot();
      const listedTasks = listedTaskIds().flatMap((id): SidebarTask[] => {
        const fact = previous?.facts[id];
        return fact ? [{ ...fact, linkedThreadIds: [] }] : [];
      });
      const source = listedTasks.find((task) => task.id === taskId);
      const previousPositions = new Map(listedTasks
        .filter((task) => source && task.projectId === source.projectId && task.status === source.status && task.parentTaskId === source.parentTaskId)
        .map((task) => [task.id, task.position]));
      if (source) {
        const targetId = beforeTaskId ?? afterTaskId;
        if (targetId)
          for (const task of reorderTaskSiblings(
            listedTasks,
            taskId,
            targetId,
            beforeTaskId ? "before" : "after",
          ))
            patchFact(task.id, (fact) => ({ ...fact, position: task.position }));
      }
      return { previousPositions };
    },
    onError: (_error, _input, context) => rollbackReorder(context?.previousPositions ?? new Map()),
    onSettled: () => settle(taskMutationPlan.reorder.invalidate, true),
  });
  return { create, remove, attachment, status, assignment, reorder };
}
