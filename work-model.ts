import type {
  PluginSidebarPullRequest,
  PluginSidebarThread,
  PluginSidebarThreadIndicator,
} from "@get-bb/plugin-sdk/app";

export type WorkGroupId =
  | "attention"
  | "running"
  | "review"
  | "waiting"
  | "background";

export interface WorkGroup {
  id: WorkGroupId;
  label: string;
  threads: PluginSidebarThread[];
}

export interface TaskSummary {
  id: string;
  projectId: string;
  projectName: string;
  key: string;
  title: string;
  status: "backlog" | "todo" | "in_progress" | "in_review" | "done" | "canceled";
  priority: "urgent" | "high" | "medium" | "low" | "none";
  parentTaskId: string | null;
}

export interface SidebarTask extends TaskSummary {
  linkedThreadIds: string[];
}

export interface TaskQueueNode {
  task: SidebarTask;
  role: "outcome" | "execution";
  children: SidebarTask[];
  hasVisibleOutcomeParent: boolean;
}

export function threadTitle(thread: PluginSidebarThread): string {
  return thread.title?.trim() || thread.titleFallback || "Untitled thread";
}

export function normalizeIndicator(value: string): string {
  return value || "none";
}

export function childrenByParent(threads: readonly PluginSidebarThread[], order: readonly string[]) {
  const groups = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    groups.set(thread.parentThreadId, [...(groups.get(thread.parentThreadId) ?? []), thread]);
  }
  return new Map([...groups].map(([id, children]) => [id, orderSiblingThreads(children, order)]));
}

export function filterThreadsWithAncestors(threads: readonly PluginSidebarThread[], projectNames: Readonly<Record<string, string>>, query: string) {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [...threads];
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const included = new Set(threads.filter((thread) => `${threadTitle(thread)} ${projectNames[thread.projectId] ?? ""}`.toLocaleLowerCase().includes(needle)).map((thread) => thread.id));
  for (const id of [...included]) for (let parent = byId.get(id)?.parentThreadId; parent; parent = byId.get(parent)?.parentThreadId) included.add(parent);
  return threads.filter((thread) => included.has(thread.id));
}

export function agentProjectionState(status: string, taskStatus: string | null): string {
  if (taskStatus === "in_review") return "review";
  return status === "active" ? "running" : status;
}

export const MAX_THREAD_ORDER_ITEMS = 2_000;

/**
 * Normalize untrusted persisted/RPC order data. Thread ids are opaque, but
 * BB's public ids are always prefixed with `thr_`; rejecting everything else
 * keeps old or corrupt KV values from leaking into future writes.
 */
export function sanitizeThreadOrder(value: unknown): string[] {
  const candidates = Array.isArray(value)
    ? value
    : value && typeof value === "object" && Array.isArray((value as { threadIds?: unknown }).threadIds)
      ? (value as { threadIds: unknown[] }).threadIds
      : [];
  const seen = new Set<string>();
  const result: string[] = [];
  for (const candidate of candidates) {
    if (typeof candidate !== "string") continue;
    const id = candidate.trim();
    if (!id.startsWith("thr_") || seen.has(id)) continue;
    seen.add(id);
    result.push(id);
    if (result.length >= MAX_THREAD_ORDER_ITEMS) break;
  }
  return result;
}

/** Strip stale ids and append newly-seen threads in the host's stable order. */
export function reconcileThreadOrder(
  storedOrder: unknown,
  threads: readonly PluginSidebarThread[],
): string[] {
  const liveIds = new Set(threads.map((thread) => thread.id));
  const order = sanitizeThreadOrder(storedOrder).filter((id) => liveIds.has(id));
  const seen = new Set(order);
  for (const thread of threads) {
    if (seen.has(thread.id)) continue;
    order.push(thread.id);
    seen.add(thread.id);
  }
  return order;
}

export function orderSiblingThreads(
  siblings: readonly PluginSidebarThread[],
  order: readonly string[],
): PluginSidebarThread[] {
  const rank = new Map(order.map((id, index) => [id, index]));
  return siblings
    .map((thread, index) => ({ thread, index }))
    .sort((left, right) =>
      (rank.get(left.thread.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.thread.id) ?? Number.MAX_SAFE_INTEGER) ||
      left.index - right.index,
    )
    .map(({ thread }) => thread);
}

export function rootThreads(
  threads: readonly PluginSidebarThread[],
  order: readonly string[],
): PluginSidebarThread[] {
  const ids = new Set(threads.map((thread) => thread.id));
  return orderSiblingThreads(
    threads.filter((thread) => !thread.parentThreadId || !ids.has(thread.parentThreadId)),
    order,
  );
}

export type ThreadOrderPlacement = "before" | "after";

/** Move only inside one parent. Invalid/cross-parent moves are no-ops. */
export function reorderThreadSibling(
  storedOrder: unknown,
  threads: readonly PluginSidebarThread[],
  sourceId: string,
  targetId: string,
  placement: ThreadOrderPlacement = "before",
): string[] {
  const current = reconcileThreadOrder(storedOrder, threads);
  if (sourceId === targetId) return current;
  const byId = new Map(threads.map((thread) => [thread.id, thread]));
  const source = byId.get(sourceId);
  const target = byId.get(targetId);
  if (!source || !target || source.parentThreadId !== target.parentThreadId) return current;
  const next = current.filter((id) => id !== sourceId);
  const targetIndex = next.indexOf(targetId);
  if (targetIndex < 0) return current;
  next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, sourceId);
  return next;
}

export function moveThreadSibling(
  storedOrder: unknown,
  threads: readonly PluginSidebarThread[],
  threadId: string,
  direction: -1 | 1,
): string[] {
  const current = reconcileThreadOrder(storedOrder, threads);
  const item = threads.find((thread) => thread.id === threadId);
  if (!item) return current;
  const siblings = orderSiblingThreads(
    threads.filter((thread) => thread.parentThreadId === item.parentThreadId),
    current,
  );
  const index = siblings.findIndex((thread) => thread.id === threadId);
  const target = siblings[index + direction];
  if (!target) return current;
  return reorderThreadSibling(
    current,
    threads,
    threadId,
    target.id,
    direction < 0 ? "before" : "after",
  );
}

const TASK_STATUS_ORDER: Readonly<Record<TaskSummary["status"], number>> = {
  in_progress: 0, in_review: 1, todo: 2, backlog: 3, done: 4, canceled: 5,
};
const TASK_PRIORITY_ORDER: Readonly<Record<TaskSummary["priority"], number>> = {
  urgent: 0, high: 1, medium: 2, low: 3, none: 4,
};

export function taskMatchesSearch(task: SidebarTask, query: string): boolean {
  const needle = query.trim().toLocaleLowerCase();
  return !needle || [task.key, task.title, task.projectName, task.status, task.priority]
    .join(" ").toLocaleLowerCase().includes(needle);
}

export function orderTasks(tasks: readonly SidebarTask[]): SidebarTask[] {
  return [...tasks].sort((left, right) =>
    TASK_STATUS_ORDER[left.status] - TASK_STATUS_ORDER[right.status] ||
    TASK_PRIORITY_ORDER[left.priority] - TASK_PRIORITY_ORDER[right.priority] ||
    left.projectName.localeCompare(right.projectName) || left.key.localeCompare(right.key) || left.id.localeCompare(right.id),
  );
}

export function projectTaskQueue(tasks: readonly SidebarTask[]): TaskQueueNode[] {
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const childrenByParent = new Map<string, SidebarTask[]>();

  for (const task of tasks) {
    if (!task.parentTaskId) continue;
    const siblings = childrenByParent.get(task.parentTaskId) ?? [];
    siblings.push(task);
    childrenByParent.set(task.parentTaskId, siblings);
  }

  const roots = orderTasks(tasks.filter((task) => !task.parentTaskId));
  const orphanExecutions = orderTasks(tasks.filter((task) => task.parentTaskId && !tasksById.has(task.parentTaskId)));

  return [
    ...roots.map((task) => ({
      task,
      role: "outcome" as const,
      children: orderTasks(childrenByParent.get(task.id) ?? []),
      hasVisibleOutcomeParent: true,
    })),
    ...orphanExecutions.map((task) => ({
      task,
      role: "execution" as const,
      children: [],
      hasVisibleOutcomeParent: false,
    })),
  ];
}

export function pullRequestKey(pullRequest: PluginSidebarPullRequest): string {
  return pullRequest.url.trim().toLocaleLowerCase() || `#${pullRequest.number}`;
}

export function uniquePullRequestThreadIds(
  threadIds: readonly string[],
  pullRequests: Readonly<Record<string, PluginSidebarPullRequest | null | undefined>>,
): string[] {
  const seen = new Set<string>();
  return threadIds.filter((threadId) => {
    const pullRequest = pullRequests[threadId];
    if (!pullRequest) return false;
    const key = pullRequestKey(pullRequest);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function matchesPullRequestSearch(
  thread: PluginSidebarThread,
  projectName: string,
  pullRequest: PluginSidebarPullRequest,
  query: string,
): boolean {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return true;
  const haystack = [
    threadTitle(thread),
    projectName,
    thread.environment?.branchName,
    thread.environment?.name,
    thread.host?.name,
    thread.providerId,
    `#${pullRequest.number}`,
    pullRequest.title,
    pullRequest.url,
    pullRequest.state,
    pullRequest.attention,
  ].filter(Boolean).join(" ").toLocaleLowerCase();
  return haystack.includes(needle);
}

export interface ThreadTaskLink {
  task: TaskSummary;
  threadId: string;
  liveStatus: "starting" | "working" | "idle" | "completed" | "failed";
  role: "outcome" | "execution";
  mode: "direct" | "delegated" | null;
  idempotencyKey: string | null;
  dispatchState: "ready" | "pending_spawn" | "pending_attachment" | "recovery_required" | null;
}

const TASK_LINK_DISPATCH_ORDER: Readonly<Record<NonNullable<ThreadTaskLink["dispatchState"]>, number>> = {
  recovery_required: 0,
  pending_attachment: 1,
  pending_spawn: 2,
  ready: 3,
};

const TASK_LINK_LIVE_ORDER: Readonly<Record<ThreadTaskLink["liveStatus"], number>> = {
  failed: 0,
  working: 1,
  starting: 2,
  idle: 3,
  completed: 4,
};

export function orderTaskLinksByRelevance(links: readonly ThreadTaskLink[]): ThreadTaskLink[] {
  return [...links].sort((left, right) =>
    (TASK_LINK_DISPATCH_ORDER[left.dispatchState ?? "ready"] ?? Number.MAX_SAFE_INTEGER) -
      (TASK_LINK_DISPATCH_ORDER[right.dispatchState ?? "ready"] ?? Number.MAX_SAFE_INTEGER) ||
    TASK_LINK_LIVE_ORDER[left.liveStatus] - TASK_LINK_LIVE_ORDER[right.liveStatus] ||
    (left.role === "execution" ? 0 : 1) - (right.role === "execution" ? 0 : 1) ||
    TASK_STATUS_ORDER[left.task.status] - TASK_STATUS_ORDER[right.task.status] ||
    left.task.key.localeCompare(right.task.key) ||
    left.task.id.localeCompare(right.task.id)
  );
}

export function primaryTaskLink(links: readonly ThreadTaskLink[]): ThreadTaskLink | null {
  return orderTaskLinksByRelevance(links)[0] ?? null;
}

export interface StackLayer {
  number: number;
  title: string;
  state: string;
  draft: boolean;
  url: string;
  head: string;
  base: string;
}

export interface CurrentPullRequestView {
  number: number;
  title: string;
  url: string;
  state: "closed" | "draft" | "merged" | "open";
  head: string;
  base: string;
  checks: {
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
    totalCount: number;
  };
  review: {
    reviewRequestCount: number;
    state: "approved" | "changes_requested" | "none" | "review_requested" | "review_required";
  };
  attention: "blocked" | "changes_requested" | "checks_failed" | "checks_pending" | "closed" | "conflicts" | "draft" | "merged" | "none" | "ready_to_merge" | "review_requested";
  mergeability: {
    mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DRAFT" | "HAS_HOOKS" | "DIRTY" | "UNKNOWN" | "UNSTABLE" | null;
    mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN" | null;
    state: "blocked" | "conflicts" | "draft" | "mergeable" | "unknown";
  };
}

export interface GoalProgressInput {
  tokensUsed: number;
  tokenBudget: number | null;
}

export function goalProgressPercent(goal: GoalProgressInput): number | null {
  if (goal.tokenBudget === null || goal.tokenBudget <= 0) return null;
  return Math.min(100, Math.max(0, Math.round((goal.tokensUsed / goal.tokenBudget) * 100)));
}

export function orderStackLayers(
  layers: readonly StackLayer[],
  base: string,
): StackLayer[] {
  const remaining = [...layers];
  const ordered: StackLayer[] = [];
  let previousHead = base;

  while (remaining.length > 0) {
    const nextIndex = remaining.findIndex((layer) => layer.base === previousHead);
    if (nextIndex < 0) break;
    const [next] = remaining.splice(nextIndex, 1);
    if (!next) break;
    ordered.push(next);
    previousHead = next.head;
  }

  // Preserve all provided layers if GitHub returns an incomplete or transient
  // dependency chain. The adapter never invents a relationship for them.
  return ordered.concat(remaining);
}


