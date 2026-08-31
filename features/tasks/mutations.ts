import { useMutation, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { reorderTaskSiblings, type SidebarTask } from "../../work-model";
import { queryKeys, workOutcomeQueryRoot } from "../../query-runtime";

type TaskList = { tasks: SidebarTask[] };
type WorkOutcomeCache = {
  executionTasks?: Array<{ id: string; assignee?: SidebarTask["assignee"] }>;
};
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type TaskScope = "list" | "links" | "outcome";

export const taskOptimisticMutationKey = ["tasks", "optimistic"] as const;
const taskAssignmentMutationScope = { id: "tasks-assignment" };
const taskReorderMutationScope = { id: "tasks-reorder" };

const invalidationState = new WeakMap<QueryClient, { deferred: Set<TaskScope> }>();

function stateFor(queryClient: QueryClient) {
  let state = invalidationState.get(queryClient);
  if (!state) {
    state = { deferred: new Set() };
    invalidationState.set(queryClient, state);
  }
  return state;
}

function hasOtherOptimisticMutation(queryClient: QueryClient, settlingOptimistic: boolean) {
  return queryClient.isMutating({ mutationKey: taskOptimisticMutationKey }) > (settlingOptimistic ? 1 : 0);
}

export function invalidateTaskQueries(queryClient: QueryClient, scopes: readonly TaskScope[], settlingOptimistic = false) {
  const state = stateFor(queryClient);
  if (hasOtherOptimisticMutation(queryClient, settlingOptimistic)) {
    scopes.forEach((scope) => state.deferred.add(scope));
    return Promise.resolve();
  }
  const finalScopes = [...new Set([...state.deferred, ...scopes])];
  state.deferred.clear();
  return Promise.all(finalScopes.map((scope) => queryClient.invalidateQueries({
    queryKey:
      scope === "list"
        ? queryKeys.sidebar.tasks.list()
        : scope === "links"
          ? queryKeys.sidebar.tasks.links()
          : workOutcomeQueryRoot(),
  })));
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

export function useTasksMutations(rpc: Rpc) {
  const queryClient = useQueryClient();
  const key = (scope: TaskScope) =>
    scope === "list"
      ? queryKeys.sidebar.tasks.list()
      : scope === "links"
        ? queryKeys.sidebar.tasks.links()
        : workOutcomeQueryRoot();
  const cancel = async (scopes: readonly TaskScope[]) => Promise.all(scopes.map((scope) => queryClient.cancelQueries({ queryKey: key(scope) })));
  const settle = (scopes: readonly TaskScope[], settlingOptimistic = false) => invalidateTaskQueries(queryClient, scopes, settlingOptimistic);
  const snapshot = () => queryClient.getQueryData<TaskList>(key("list"));
  const rollbackAssignment = (taskId: string, assignee: SidebarTask["assignee"] | undefined) => {
    if (!assignee) return;
    queryClient.setQueryData<TaskList>(key("list"), (current) => current && {
      ...current,
      tasks: current.tasks.map((task) => task.id === taskId ? { ...task, assignee } : task),
    });
  };
  const patchOutcomeAssignment = (
    taskId: string,
    assignee: SidebarTask["assignee"],
  ) => {
    queryClient.setQueriesData<WorkOutcomeCache>(
      { queryKey: workOutcomeQueryRoot() },
      (current) =>
        current?.executionTasks
          ? {
              ...current,
              executionTasks: current.executionTasks.map((task) =>
                task.id === taskId ? { ...task, assignee } : task,
              ),
            }
          : current,
    );
  };
  const rollbackReorder = (positions: ReadonlyMap<string, number | undefined>) => {
    queryClient.setQueryData<TaskList>(key("list"), (current) => current && {
      ...current,
      tasks: current.tasks.map((task) => positions.has(task.id) ? { ...task, position: positions.get(task.id) } : task),
    });
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
      const previousOutcomes = queryClient.getQueriesData<WorkOutcomeCache>({
        queryKey: workOutcomeQueryRoot(),
      });
      const previousAssignee = previous?.tasks.find((task) => task.id === taskId)?.assignee;
      queryClient.setQueryData<TaskList>(key("list"), (current) => current && {
        ...current,
        tasks: current.tasks.map((task) => task.id === taskId ? { ...task, assignee } : task),
      });
      patchOutcomeAssignment(taskId, assignee);
      return { previousAssignee, previousOutcomes };
    },
    onError: (_error, { taskId }, context) => {
      rollbackAssignment(taskId, context?.previousAssignee);
      for (const [queryKey, value] of context?.previousOutcomes ?? [])
        queryClient.setQueryData(queryKey, value);
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
      const source = previous?.tasks.find((task) => task.id === taskId);
      const previousPositions = new Map((previous?.tasks ?? [])
        .filter((task) => source && task.projectId === source.projectId && task.status === source.status && task.parentTaskId === source.parentTaskId)
        .map((task) => [task.id, task.position]));
      if (previous) {
        const targetId = beforeTaskId ?? afterTaskId;
        if (targetId) queryClient.setQueryData<TaskList>(key("list"), {
          ...previous,
          tasks: reorderTaskSiblings(previous.tasks, taskId, targetId, beforeTaskId ? "before" : "after"),
        });
      }
      return { previousPositions };
    },
    onError: (_error, _input, context) => rollbackReorder(context?.previousPositions ?? new Map()),
    onSettled: () => settle(taskMutationPlan.reorder.invalidate, true),
  });
  return { create, remove, attachment, status, assignment, reorder };
}
