import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { reorderTaskSiblings, type SidebarTask } from "../../work-model";
import { queryKeys } from "../../query-runtime";

type TaskList = { tasks: SidebarTask[] };
type Rpc = ReturnType<typeof useRpc<typeof rpcContract>>;
type TaskScope = "list" | "links";
let optimisticTaskMutationCount = 0;
let deferredTaskInvalidation = false;

export function invalidateTaskQueries(queryClient: ReturnType<typeof useQueryClient>, scopes: readonly TaskScope[]) {
  if (optimisticTaskMutationCount > 0) { deferredTaskInvalidation = true; return Promise.resolve(); }
  const finalScopes = deferredTaskInvalidation ? ["list", "links"] as const : scopes;
  deferredTaskInvalidation = false;
  return Promise.all(finalScopes.map((scope) => queryClient.invalidateQueries({ queryKey: scope === "list" ? queryKeys.sidebar.tasks.list() : queryKeys.sidebar.tasks.links() })));
}

export const taskMutationPlan = {
  create: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list", "links"] },
  delete: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list", "links"] },
  attach: { optimistic: false, rollback: false, cancel: ["list", "links"], invalidate: ["list", "links"] },
  detach: { optimistic: false, rollback: false, cancel: ["list", "links"], invalidate: ["list", "links"] },
  status: { optimistic: false, rollback: false, cancel: ["list"], invalidate: ["list"] },
  assignment: { optimistic: true, rollback: true, cancel: ["list"], invalidate: ["list"] },
  reorder: { optimistic: true, rollback: true, cancel: ["list"], invalidate: ["list"] },
} as const satisfies Record<string, { optimistic: boolean; rollback: boolean; cancel: readonly TaskScope[]; invalidate: readonly TaskScope[] }>;

export function useTasksMutations(rpc: Rpc) {
  const queryClient = useQueryClient();
  const key = (scope: TaskScope) => scope === "list" ? queryKeys.sidebar.tasks.list() : queryKeys.sidebar.tasks.links();
  const cancel = async (scopes: readonly TaskScope[]) => Promise.all(scopes.map((scope) => queryClient.cancelQueries({ queryKey: key(scope) })));
  const settle = (scopes: readonly TaskScope[]) => invalidateTaskQueries(queryClient, scopes);
  const snapshot = () => queryClient.getQueryData<TaskList>(key("list"));
  const rollback = (previous: TaskList | undefined) => queryClient.setQueryData(key("list"), previous);

  const create = useMutation({ mutationFn: (input: { projectId: string; title: string; assignee: SidebarTask["assignee"] }) => rpc.call("createSidebarTask", input), onMutate: async () => { await cancel(taskMutationPlan.create.cancel); }, onSettled: () => settle(taskMutationPlan.create.invalidate) });
  const remove = useMutation({ mutationFn: (input: { taskId: string }) => rpc.call("deleteSidebarTask", input), onMutate: async () => { await cancel(taskMutationPlan.delete.cancel); }, onSettled: () => settle(taskMutationPlan.delete.invalidate) });
  const attachment = useMutation({ mutationFn: ({ taskId, threadId, attached }: { taskId: string; threadId: string; attached: boolean }) => rpc.call(attached ? "attachTaskToThread" : "detachTaskFromThread", { taskId, threadId }), onMutate: async ({ attached }) => { await cancel(attached ? taskMutationPlan.attach.cancel : taskMutationPlan.detach.cancel); }, onSettled: (_data, _error, { attached }) => settle(attached ? taskMutationPlan.attach.invalidate : taskMutationPlan.detach.invalidate) });
  const status = useMutation({ mutationFn: (input: { taskId: string; status: SidebarTask["status"] }) => rpc.call("updateTaskStatus", input), onMutate: async () => { await cancel(taskMutationPlan.status.cancel); }, onSettled: () => settle(taskMutationPlan.status.invalidate) });
  const assignment = useMutation({ mutationFn: (input: { taskId: string; assignee: SidebarTask["assignee"] }) => rpc.call("updateTaskAssignee", input), onMutate: async ({ taskId, assignee }) => { await cancel(taskMutationPlan.assignment.cancel); optimisticTaskMutationCount += 1; const previous = snapshot(); queryClient.setQueryData<TaskList>(key("list"), (current) => current && { ...current, tasks: current.tasks.map((task) => task.id === taskId ? { ...task, assignee } : task) }); return { previous }; }, onError: (_error, _input, context) => rollback(context?.previous), onSettled: () => { optimisticTaskMutationCount -= 1; return settle(taskMutationPlan.assignment.invalidate); } });
  const reorder = useMutation({ mutationFn: (input: { taskId: string; beforeTaskId: string | null; afterTaskId: string | null }) => rpc.call("reorderTask", input), onMutate: async ({ taskId, beforeTaskId, afterTaskId }) => { await cancel(taskMutationPlan.reorder.cancel); optimisticTaskMutationCount += 1; const previous = snapshot(); if (previous) { const targetId = beforeTaskId ?? afterTaskId; if (targetId) queryClient.setQueryData<TaskList>(key("list"), { ...previous, tasks: reorderTaskSiblings(previous.tasks, taskId, targetId, beforeTaskId ? "before" : "after") }); } return { previous }; }, onError: (_error, _input, context) => rollback(context?.previous), onSettled: () => { optimisticTaskMutationCount -= 1; return settle(taskMutationPlan.reorder.invalidate); } });
  return { create, remove, attachment, status, assignment, reorder };
}
