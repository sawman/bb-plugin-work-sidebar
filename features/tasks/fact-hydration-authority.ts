import type { QueryClient } from "@tanstack/react-query";

type TaskFactHydrationAuthority = {
  revision: number;
  optimisticAssignees: Map<string, number>;
};

const authorityByClient = new WeakMap<QueryClient, TaskFactHydrationAuthority>();

function authorityFor(queryClient: QueryClient) {
  let authority = authorityByClient.get(queryClient);
  if (!authority) {
    authority = { revision: 0, optimisticAssignees: new Map() };
    authorityByClient.set(queryClient, authority);
  }
  return authority;
}

/** Capture before an RPC read so a later optimistic revision can reject it. */
export function captureTaskFactHydrationRevision(queryClient: QueryClient) {
  return authorityFor(queryClient).revision;
}

export function isCurrentTaskFactHydration(
  queryClient: QueryClient,
  revision: number,
) {
  return authorityFor(queryClient).revision === revision;
}

export function optimisticTaskAssigneeIds(queryClient: QueryClient) {
  return authorityFor(queryClient).optimisticAssignees.keys();
}

/**
 * Claim assignee authority before cancellation: RPC reads that started before,
 * during, or finish after the mutation cannot overwrite the projection.
 */
export function beginOptimisticTaskAssignment(
  queryClient: QueryClient,
  taskId: string,
) {
  const authority = authorityFor(queryClient);
  const token = ++authority.revision;
  authority.optimisticAssignees.set(taskId, token);
  return token;
}

export function endOptimisticTaskAssignment(
  queryClient: QueryClient,
  taskId: string,
  token: number,
) {
  const authority = authorityFor(queryClient);
  if (authority.optimisticAssignees.get(taskId) !== token) return;
  authority.optimisticAssignees.delete(taskId);
  authority.revision += 1;
}
