import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

export type AgentProjectionChild = {
  thread: PluginSidebarThread;
  depth: number;
};

/** Project the visible host roster into a parent's recursive child tree. */
export function projectAgentChildren(
  threads: readonly PluginSidebarThread[],
  parentThreadId: string,
): AgentProjectionChild[] {
  const childrenByParent = new Map<string, PluginSidebarThread[]>();
  for (const thread of threads) {
    if (!thread.parentThreadId) continue;
    const siblings = childrenByParent.get(thread.parentThreadId) ?? [];
    siblings.push(thread);
    childrenByParent.set(thread.parentThreadId, siblings);
  }

  const result: AgentProjectionChild[] = [];
  const visit = (parentId: string, depth: number, ancestors: ReadonlySet<string>) => {
    for (const child of childrenByParent.get(parentId) ?? []) {
      if (child.isArchived || ancestors.has(child.id)) continue;
      result.push({ thread: child, depth });
      visit(child.id, depth + 1, new Set([...ancestors, child.id]));
    }
  };
  visit(parentThreadId, 1, new Set([parentThreadId]));
  return result;
}

export type AgentRuntimePresentation = {
  label: "Working" | "Waiting" | "Blocked" | "Complete" | "Idle";
  tone: "working" | "waiting" | "blocked" | "complete" | "idle";
};

/** Translate only host-owned thread signals into the Agents row status. */
export function agentRuntimePresentation(
  thread: PluginSidebarThread,
): AgentRuntimePresentation {
  if (thread.indicator === "unread-error")
    return { label: "Blocked", tone: "blocked" };
  if (thread.hasPendingInteraction || thread.indicator === "waiting-for-input")
    return { label: "Waiting", tone: "waiting" };
  if (thread.indicator === "unread-success")
    return { label: "Complete", tone: "complete" };
  if (
    thread.indicator === "background-agent" ||
    thread.indicator === "background-command" ||
    thread.indicator === "goal" ||
    thread.indicator === "runtime" ||
    thread.indicator === "workflow" ||
    thread.indicator === "plan-mode" ||
    thread.activity.workflows > 0 ||
    thread.activity.backgroundAgents > 0 ||
    thread.activity.backgroundCommands > 0 ||
    thread.activity.planMode > 0 ||
    thread.activity.goals > 0
  )
    return { label: "Working", tone: "working" };
  return { label: "Idle", tone: "idle" };
}
