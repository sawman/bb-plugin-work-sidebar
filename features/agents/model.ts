import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  adaptSidebarThreadActivity,
  threadActivityPresentation,
} from "../../shared/thread-activity";

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
  label: "Working" | "Waiting" | "Queued" | "Blocked" | "Complete" | "Idle";
  tone: "working" | "waiting" | "blocked" | "complete" | "idle";
};

export type AgentWorkspacePresentation = {
  label: string;
  detail: string;
  copyValue: string;
  kind: "managed-worktree" | "unmanaged-worktree" | "workspace" | "host";
};

/** Prefer the branch, then the named worktree, then the host supplied by BB. */
export function agentWorkspacePresentation(
  thread: PluginSidebarThread,
): AgentWorkspacePresentation | null {
  const environment = thread.environment;
  if (environment) {
    const name = environment.name?.trim();
    const branch = environment.branchName?.trim();
    const workspaceKind =
      environment.workspaceDisplayKind === "managed-worktree"
        ? "Managed worktree"
        : environment.workspaceDisplayKind === "unmanaged-worktree"
          ? "Unmanaged worktree"
          : "Workspace";
    const kind =
      environment.workspaceDisplayKind === "managed-worktree"
        ? "managed-worktree"
        : environment.workspaceDisplayKind === "unmanaged-worktree"
          ? "unmanaged-worktree"
          : "workspace";
    const detail =
      name && kind !== "workspace"
        ? /worktree/i.test(name)
          ? name
          : `${name} worktree`
        : workspaceKind;
    const workspaceCopyValue =
      kind === "workspace"
        ? name
          ? `Workspace ${name}`
          : "Workspace"
        : name
          ? `Worktree ${name.replace(/\s+worktree$/i, "") || name}`
          : workspaceKind;
    const copyValue = branch
      ? `Branch ${branch} · ${workspaceCopyValue}`
      : workspaceCopyValue;
    return { label: branch || name || workspaceKind, detail, copyValue, kind };
  }
  if (thread.host)
    return {
      label: thread.host.name,
      detail: "Host workspace",
      copyValue: `Host workspace ${thread.host.name}`,
      kind: "host",
    };
  return null;
}

/** Format elapsed thread age; BB does not expose a continuous compute timer. */
export function agentDurationLabel(
  createdAt: number,
  now: number,
): string | null {
  if (!Number.isFinite(createdAt) || createdAt <= 0 || now < createdAt)
    return null;
  const seconds = Math.floor((now - createdAt) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Translate only host-owned thread signals into the Agents row status. */
export function agentRuntimePresentation(
  thread: PluginSidebarThread,
): AgentRuntimePresentation {
  const presentation = threadActivityPresentation(
    adaptSidebarThreadActivity(thread),
  );
  return { label: presentation.label, tone: presentation.tone };
}
