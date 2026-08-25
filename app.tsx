import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  definePluginApp,
  useBbNavigate,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadPullRequest,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadHeaderActionProps,
  PluginThreadListProps,
  PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { Input } from "@/components/ui/input";
import type { rpcContract } from "./contracts";
import {
  childrenByParent,
  filterThreadsWithAncestors,
  moveThreadSibling,
  matchesPullRequestSearch,
  normalizeIndicator,
  reconcileThreadOrder,
  reorderThreadSibling,
  rootThreads,
  uniquePullRequestThreadIds,
  threadTitle,
  type ThreadTaskLink,
  reorderTaskSiblings,
  taskReorderNeighbors,
  orderTaskLinksByRelevance,
  projectTaskQueue,
  taskMatchesSearch,
  type TaskQueueNode,
  type SidebarTask,
  agentProjectionState,
  goalProgressPercent,
  orderStackLayers,
  type CurrentPullRequestView,
  projectPullRequestGroups,
  type SidebarStack,
} from "./work-model";
import { Icon } from "@/components/ui/icon";
import "./app.css";
import "./scrollbar.css";
import "./views.css";

const SIDEBAR_ORDER_CHANNEL = "sidebar-order:changed";

function indicatorGlyph(value: string): string {
  switch (normalizeIndicator(value)) {
    case "runtime": case "workflow": case "background-agent": case "background-command": return "●";
    case "unread-error": return "!";
    case "unread-success": return "•";
    case "waiting-for-input": return "?";
    case "goal": case "plan-mode": return "";
    default: return "";
  }
}

function threadPullRequestTone(pullRequest: { state: string; attention: string }): "open" | "draft" | "problem" | "merged" | "closed" {
  if (pullRequest.state === "closed") return "closed";
  if (pullRequest.state === "merged") return "merged";
  if (pullRequest.state === "draft") return "draft";
  return pullRequest.attention === "changes_requested" || pullRequest.attention === "checks_failed" || pullRequest.attention === "conflicts" ? "problem" : "open";
}

function visibleThreadTreeIds(roots: readonly PluginSidebarThread[], childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>): string[] {
  const ids: string[] = [];
  const visit = (thread: PluginSidebarThread) => {
    ids.push(thread.id);
    for (const child of childrenByThread.get(thread.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return ids;
}

function ThreadRow({
  thread,
  active,
  taskLinks,
  children,
  childrenExpanded,
  selected,
  later,
  onToggleChildren,
  onSelect,
  onToggleLater,
  project,
  onNavigate,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  canDropThread,
  onDropThread,
  onMoveThread,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  taskLinks?: readonly ThreadTaskLink[];
  children: number;
  childrenExpanded: boolean;
  selected: boolean;
  later: boolean;
  onToggleChildren(): void;
  onSelect(thread: PluginSidebarThread, event: ReactMouseEvent<HTMLAnchorElement>): boolean;
  onToggleLater(threadId: string): void;
  project?: { name: string; isPersonal: boolean };
  onNavigate(): void;
  reorderDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  dropTarget: { threadId: string; placement: "before" | "after" } | null;
  onDropTargetChange(target: { threadId: string; placement: "before" | "after" } | null): void;
  canDropThread(sourceId: string): boolean;
  onDropThread(sourceId: string, targetId: string, placement: "before" | "after"): void;
  onMoveThread(threadId: string, direction: -1 | 1): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(thread.id);
  const { pullRequest, isLoading: pullRequestLoading } = experimental_useSidebarThreadPullRequest(thread.id);
  const controlClick = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(threadTitle(thread));
  const projectLabel = project?.isPersonal ? "Personal" : project?.name ?? "Project";
  const title = threadTitle(thread);
  const indicator = normalizeIndicator(String(thread.indicator));
  const working = indicator === "runtime" || indicator === "workflow" || indicator === "background-agent" || indicator === "background-command" || indicator === "goal" || indicator === "plan-mode" || indicator === "working-draft";
  const pullRequestTone = pullRequest ? threadPullRequestTone(pullRequest) : null;

  const open = (split = false) => {
    actions.open(thread.id, { split });
    onNavigate();
  };
  const commitRename = async () => {
    const next = draftTitle.trim();
    if (next && next !== threadTitle(thread)) await actions.rename(thread.id, next);
    setRenaming(false);
  };
  // These sidebar action APIs own the recursive tree mutation: archive closes
  // the parent and every descendant, and delete opens BB's child-counting
  // recursive confirmation. Never fan out child actions here.
  const archiveTree = () => actions.archive(thread.id);
  const requestDeleteTree = () => actions.requestDelete(thread.id);

  return (
    <div
      className={`ws-thread ${active ? "ws-thread-active" : ""} ${selected ? "ws-thread-selected" : ""} ${dragThreadId === thread.id ? "ws-thread-dragging" : ""}`}
      data-depth={thread.parentThreadId ? "child" : "root"}
      data-drop-placement={dropTarget?.threadId === thread.id ? dropTarget.placement : undefined}
      draggable={!reorderDisabled}
      onDragStart={(event) => {
        if (reorderDisabled) return;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", thread.id);
        onDragThreadChange(thread.id);
        onDropTargetChange(null);
      }}
      onDragEnd={() => { onDragThreadChange(null); onDropTargetChange(null); }}
      onDragOver={(event) => {
        const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain");
        if (reorderDisabled || !sourceId || sourceId === thread.id || !canDropThread(sourceId)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        const bounds = event.currentTarget.getBoundingClientRect();
        onDropTargetChange({ threadId: thread.id, placement: event.clientY > bounds.top + bounds.height / 2 ? "after" : "before" });
      }}
      onDrop={(event) => {
        const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain");
        if (reorderDisabled || !sourceId || sourceId === thread.id || !canDropThread(sourceId)) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const placement = event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
        onDropThread(sourceId, thread.id, placement);
        onDragThreadChange(null);
        onDropTargetChange(null);
      }}
    >
      {children > 0 ? <button
        type="button"
        className="ws-thread-disclosure"
        aria-label={`${childrenExpanded ? "Collapse" : "Expand"} ${children} child agent${children === 1 ? "" : "s"}`}
        aria-expanded={childrenExpanded}
        onClick={onToggleChildren}
      >{childrenExpanded ? "⌄" : "›"}</button> : <span className="ws-thread-disclosure-placeholder" aria-hidden="true" />}
      {renaming ? (
        <div className="ws-rename">
          <Input
            autoFocus value={draftTitle} aria-label="Thread title"
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => void commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void commitRename();
              if (event.key === "Escape") setRenaming(false);
            }}
          />
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <a

              href="#"
              {...splitProps}
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              className={`ws-thread-anchor ${children > 0 ? "ws-thread-has-children" : ""}`}
              aria-selected={selected}
              onMouseDown={(event) => { controlClick.current = event.ctrlKey && event.button === 0; }}
              onClick={(event) => { event.preventDefault(); if (!onSelect(thread, event)) open(false); }}
              onContextMenu={(event) => { if (!controlClick.current && !event.ctrlKey) return; controlClick.current = false; event.preventDefault(); onSelect(thread, event); }}
              onKeyDown={(event) => {
                if (event.key !== "ContextMenu" && !(event.key === "F10" && event.shiftKey)) return;
                event.preventDefault();
                const target = event.currentTarget;
                const bounds = target.getBoundingClientRect();
                target.dispatchEvent(new MouseEvent("contextmenu", {
                  bubbles: true,
                  clientX: bounds.left + Math.min(bounds.width, 12),
                  clientY: bounds.bottom,
                }));
              }}
            >
              <Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} className="ws-project-icon" aria-label={`${projectLabel} ${project?.isPersonal ? "work" : "project"}`} />
              <span className="ws-thread-main">
                <span className={`ws-thread-title ${thread.isUnread ? "ws-unread" : ""}`}>{title}</span>
                <span className="ws-thread-meta">
                  {pullRequest && <span className={`ws-pr-meta ws-thread-token ws-thread-pr-token ws-thread-pr-${pullRequestTone}`} title={`PR #${pullRequest.number} · ${pullRequest.attention === "ready_to_merge" ? "Ready to merge" : pullRequest.state}`}><Icon name={pullRequestTone === "closed" ? "X" : pullRequest.attention === "ready_to_merge" ? "Check" : "GitPullRequest"} aria-hidden /><span>#{pullRequest.number}</span></span>}
                  {children > 0 && <span className="ws-thread-agent-count ws-thread-token" title={`${children} agent${children === 1 ? "" : "s"}`}><Icon name="Bot" aria-hidden /><span>{children}</span></span>}
                  <span className="ws-thread-worktree" title={thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}><Icon name="GitBranch" aria-hidden /><span>{thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}</span></span>
                  {orderTaskLinksByRelevance(taskLinks ?? []).map((taskLink) => <span className="ws-task-link" key={`${taskLink.task.id}:${taskLink.role}`} title={`${taskLink.task.title} · ${taskLink.task.key}`}><Icon name="ListTodo" aria-hidden /><small className="ws-task-key">{taskLink.task.key}</small></span>)}
                  {pullRequestLoading && <span className="ws-pr-meta" aria-label="Pull request loading">PR loading…</span>}
                </span>
              </span>
              <span className="ws-thread-trailing">
                <span className={`ws-status ws-status-${indicator} ${working ? "ws-status-working" : ""}`} aria-label={thread.indicatorLabel ?? undefined}>
                  {working ? <span className="ws-status-dots" aria-hidden><i /><i /><i /></span> : indicatorGlyph(String(thread.indicator))}
                </span>
                {thread.isPinned && <Icon name="Pin" className="ws-thread-pin" aria-label="Pinned" />}
                {thread.isUnread && !working && indicator !== "unread-success" && <span className="ws-unread-dot" title="Unread" />}
              </span>
            </a>
          </ContextMenuTrigger>
          <ContextMenuContent aria-label={`Actions for ${title}`}>
            <ContextMenuLabel>{title}</ContextMenuLabel>
            <ContextMenuItem onSelect={() => open(false)}>Open</ContextMenuItem>
            {isAvailable && <ContextMenuItem onSelect={() => open(true)}>Open in split</ContextMenuItem>}
            <ContextMenuSeparator />
            <ContextMenuItem disabled={reorderDisabled || !canMoveUp} onSelect={() => onMoveThread(thread.id, -1)}>
              Move up
            </ContextMenuItem>
            <ContextMenuItem disabled={reorderDisabled || !canMoveDown} onSelect={() => onMoveThread(thread.id, 1)}>
              Move down
            </ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem onSelect={() => void actions.setPinned(thread.id, !thread.isPinned)}>
              {thread.isPinned ? "Unpin" : "Pin"}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => void actions.setRead(thread.id, thread.isUnread)}>
              {thread.isUnread ? "Mark read" : "Mark unread"}
            </ContextMenuItem>
            <ContextMenuItem onSelect={() => setRenaming(true)}>Rename</ContextMenuItem>
            <ContextMenuItem onSelect={() => onToggleLater(thread.id)}>{later ? "Restore from Later" : "Move to Later"}</ContextMenuItem>
            <ContextMenuItem onSelect={archiveTree}>Archive</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={requestDeleteTree}>
              Delete
            </ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      )}
    </div>
  );
}

function WorkThreadTree({
  thread,
  childrenByThread,
  taskLinks,
  activeThreadId,
  selectedThreadIds,
  laterThreadIds,
  projectsById,
  onNavigate,
  onSelect,
  onToggleLater,
  orderedSiblings,
  reorderDisabled,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  onDropThread,
  onMoveThread,
  depth = 0,
}: {
  thread: PluginSidebarThread;
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  activeThreadId: string | null;
  selectedThreadIds: ReadonlySet<string>;
  laterThreadIds: ReadonlySet<string>;
  projectsById: ReadonlyMap<string, { name: string; isPersonal: boolean }>;
  onNavigate(): void;
  onSelect(thread: PluginSidebarThread, event: ReactMouseEvent<HTMLAnchorElement>): boolean;
  onToggleLater(threadId: string): void;
  orderedSiblings: readonly PluginSidebarThread[];
  reorderDisabled: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  dropTarget: { threadId: string; placement: "before" | "after" } | null;
  onDropTargetChange(target: { threadId: string; placement: "before" | "after" } | null): void;
  onDropThread(sourceId: string, targetId: string, placement: "before" | "after"): void;
  onMoveThread(threadId: string, direction: -1 | 1): void;
  depth?: number;
}) {
  const children = childrenByThread.get(thread.id) ?? [];
  // New child agents should not take over the sidebar; reveal each subtree
  // only when the user deliberately opens its disclosure.
  const [childrenExpanded, setChildrenExpanded] = useState(false);
  const siblingIndex = orderedSiblings.findIndex((sibling) => sibling.id === thread.id);
  return (
    <>
      <ThreadRow
        thread={thread}
        active={thread.id === activeThreadId}
        taskLinks={taskLinks[thread.id]}
        children={children.length}
        childrenExpanded={childrenExpanded}
        selected={selectedThreadIds.has(thread.id)}
        later={laterThreadIds.has(thread.id)}
        onToggleChildren={() => setChildrenExpanded((expanded) => !expanded)}
        onSelect={onSelect}
        onToggleLater={onToggleLater}
        project={projectsById.get(thread.projectId)}
        onNavigate={onNavigate}
        reorderDisabled={reorderDisabled}
        canMoveUp={siblingIndex > 0}
        canMoveDown={siblingIndex >= 0 && siblingIndex < orderedSiblings.length - 1}
        dragThreadId={dragThreadId}
        onDragThreadChange={onDragThreadChange}
        dropTarget={dropTarget}
        onDropTargetChange={onDropTargetChange}
        canDropThread={(sourceId) => orderedSiblings.some((sibling) => sibling.id === sourceId)}
        onDropThread={onDropThread}
        onMoveThread={onMoveThread}
      />
      {childrenExpanded && children.map((child) => (
        <div key={child.id} className={`ws-thread-child-depth-${Math.min(depth + 1, 4)}`}>
          <WorkThreadTree
            thread={child}
            childrenByThread={childrenByThread}
            taskLinks={taskLinks}
            activeThreadId={activeThreadId}
            selectedThreadIds={selectedThreadIds}
            laterThreadIds={laterThreadIds}
            projectsById={projectsById}
            onNavigate={onNavigate}
            onSelect={onSelect}
            onToggleLater={onToggleLater}
            orderedSiblings={children}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={onDragThreadChange}
            dropTarget={dropTarget}
            onDropTargetChange={onDropTargetChange}
            onDropThread={onDropThread}
            onMoveThread={onMoveThread}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  );
}

function pullRequestRepository(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : null;
  } catch { return null; }
}

type AuthoredPullRequest = {
  number: number; title: string; url: string; repository: string;
  state: "open" | "draft"; draft: boolean; head: string; base: string;
  checks?: "failed" | "passing" | "pending" | "none";
  review?: "approved" | "changes_requested" | "review_requested" | "review_required" | "none";
  stack: SidebarStack | null;
};

type ArchivedThread = {
  id: string; projectId: string; title: string | null; titleFallback: string | null; parentThreadId: string | null;
  environmentBranchName: string | null; isPinned: boolean; isUnread: boolean; createdAt: number; updatedAt: number; archivedAt: number;
};

function authoredCheckStatus(checks: AuthoredPullRequest["checks"]): { icon: string; label: string } {
  return checks === "failed" ? { icon: "X", label: "Checks failed" } : checks === "passing" ? { icon: "Check", label: "Checks passing" } : checks === "pending" ? { icon: "LoaderCircle", label: "Checks pending" } : { icon: "Circle", label: "No checks" };
}
function authoredReviewStatus(review: AuthoredPullRequest["review"]): { icon: string; label: string } {
  return review === "approved" ? { icon: "Check", label: "Approved" } : review === "changes_requested" ? { icon: "Wrench", label: "Changes requested" } : review === "review_requested" ? { icon: "User", label: "Review requested" } : review === "review_required" ? { icon: "Eye", label: "Review required" } : { icon: "Circle", label: "No review" };
}

function AuthoredPullRequestRow({ pullRequest, stackControl, selected, changingDraft, onSelect, onToggleDraft }: { pullRequest: Omit<AuthoredPullRequest, "stack">; stackControl?: React.ReactNode; selected: boolean; changingDraft: boolean; onSelect(id: string, event: ReactMouseEvent<HTMLAnchorElement>): boolean; onToggleDraft(pullRequest: Omit<AuthoredPullRequest, "stack">): void }) {
  const controlClick = useRef(false);
  const state = { icon: "GitPullRequest", label: pullRequest.draft ? "Draft" : "Open" };
  const checks = authoredCheckStatus(pullRequest.checks);
  const review = authoredReviewStatus(pullRequest.review);
  return <article className={`ws-pr-row ws-pr-compact-row ${selected ? "ws-pr-row-selected" : ""}`} aria-selected={selected}>
    <span className="ws-pr-stack-slot">{stackControl}</span>
    <a className="ws-pr-target" href={pullRequest.url} target="_blank" rel="noreferrer" aria-label={`Open pull request #${pullRequest.number}: ${pullRequest.title}`} onMouseDown={(event) => { controlClick.current = event.ctrlKey && event.button === 0; }} onClick={(event) => { if (onSelect(pullRequest.url, event)) event.preventDefault(); }} onContextMenu={(event) => { if (!controlClick.current && !event.ctrlKey) return; controlClick.current = false; event.preventDefault(); onSelect(pullRequest.url, event); }}>
      <strong className="ws-pr-title ws-pr-target-title">{pullRequest.title}</strong>
      <span className="ws-pr-context ws-pr-target-context"><span className="ws-pr-number">#{pullRequest.number}</span><span className="ws-pr-branch">{pullRequest.head || "Authored by you"}</span></span>
    </a>
    <span className="ws-pr-status-icons"><span data-tooltip={changingDraft ? "Updating…" : `${pullRequest.draft ? "Mark open" : "Mark draft"}`}><button type="button" className="ws-pr-state-toggle" disabled={changingDraft} aria-label={changingDraft ? "Updating pull request state" : `${pullRequest.draft ? "Mark open" : "Mark draft"}`} onClick={() => onToggleDraft(pullRequest)}><Icon name={changingDraft ? "LoaderCircle" : state.icon} aria-label={state.label} className={`ws-pr-status-icon ws-pr-state-${pullRequest.draft ? "draft" : "open"} ${changingDraft ? "ws-pr-status-spinning" : ""}`} /></button></span><span data-tooltip={checks.label}><Icon name={checks.icon} aria-label={checks.label} className={`ws-pr-status-icon ws-pr-checks-${pullRequest.checks ?? "none"}`} /></span><span data-tooltip={review.label}><Icon name={review.icon} aria-label={review.label} className={`ws-pr-status-icon ws-pr-review-${pullRequest.review ?? "none"}`} /></span></span>
  </article>;
}

function AuthoredPullRequestStack({ stack, selectedIds, changingDraftUrl, onSelect, onToggleDraft }: { stack: SidebarStack; selectedIds: ReadonlySet<string>; changingDraftUrl: string | null; onSelect(id: string, event: ReactMouseEvent<HTMLAnchorElement>): boolean; onToggleDraft(pullRequest: Omit<AuthoredPullRequest, "stack">): void }) {
  const [expanded, setExpanded] = useState(false);
  const layers = orderStackLayers(stack.pullRequests, stack.base);
  const base = layers[0];
  if (!base) return null;
  const row = (layer: SidebarStack["pullRequests"][number], stackControl?: React.ReactNode) => <AuthoredPullRequestRow key={layer.number} stackControl={stackControl} selected={selectedIds.has(layer.url)} changingDraft={changingDraftUrl === layer.url} onSelect={onSelect} onToggleDraft={onToggleDraft} pullRequest={{ ...layer, repository: "", state: layer.draft ? "draft" : "open" }} />;
  return <section className={`ws-pr-stack ${expanded ? "ws-pr-stack-open" : "ws-pr-stack-closed"}`} aria-label={`Stack rooted at ${stack.base}`}>
    {row(base, layers.length > 1 ? <button type="button" className="ws-pr-stack-disclosure" data-state={expanded ? "open" : "closed"} aria-expanded={expanded} aria-label={`${expanded ? "Collapse" : "Expand"} stack layers`} onClick={() => setExpanded((value) => !value)} aria-hidden={false}>›</button> : undefined)}
    {expanded && layers.slice(1).map((layer) => <div className="ws-pr-stack-layer-item" key={layer.number}>{row(layer)}</div>)}
  </section>;
}

/** Keep PR discovery alive regardless of which sidebar tab is selected. */
function PullRequestRow({
  thread,
  active,
  projectName,
  query,
  visible,
  stackName,
  stackExpanded,
  onToggleStack,
  onNavigate,
  onStateChange,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  projectName: string;
  query: string;
  visible: boolean;
  stackName?: string;
  stackExpanded?: boolean;
  onToggleStack?(): void;
  onNavigate(): void;
  onStateChange(threadId: string, state: { isLoading: boolean; pullRequest: ReturnType<typeof experimental_useSidebarThreadPullRequest>["pullRequest"] }): void;
}) {
  const { splitProps } = experimental_useSidebarThreadSplit(thread.id);
  const { pullRequest, isLoading } = experimental_useSidebarThreadPullRequest(thread.id);
  const signature = pullRequest ? `${pullRequest.number}:${pullRequest.title}:${pullRequest.url}:${pullRequest.state}:${pullRequest.attention}` : "none";
  useEffect(() => { onStateChange(thread.id, { isLoading, pullRequest }); }, [isLoading, onStateChange, signature, thread.id]);
  if (!visible || (!pullRequest && !isLoading)) return null;
  if (pullRequest && !matchesPullRequestSearch(thread, projectName, pullRequest, query)) return null;
  const repository = pullRequest ? pullRequestRepository(pullRequest.url) : null;
  return (
    <div className={`ws-pr-row ws-pr-compact-row ${active ? "ws-thread-active" : ""}`}>
      <div className="ws-pr-row-main"><a
          href={pullRequest?.url ?? "#"} target={pullRequest ? "_blank" : undefined} rel={pullRequest ? "noreferrer" : undefined}
          {...splitProps} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}
          className="ws-pr-target"
        >
          <span className="ws-pr-meta ws-pr-target-meta">{repository && <span className="ws-pr-repository">{repository}</span>}{pullRequest && <span className="ws-pr-number">#{pullRequest.number}</span>}<span className="sr-only">{pullRequest?.state ?? "Loading"}</span></span>
          <strong className="ws-pr-title ws-pr-target-title">{pullRequest ? pullRequest.title : "Loading pull request…"}</strong>
          <span className="ws-pr-context ws-pr-target-context">{pullRequest && <span>{pullRequest.state}</span>}{thread.environment?.branchName && <span>{thread.environment.branchName}</span>}</span>
          {pullRequest && <span className={`ws-pr-list-badge ws-pr-list-state ws-pr-list-state-${pullRequest.state}`} title={pullRequest.state} aria-label={pullRequest.state}>{pullRequest.state === "merged" ? "✓" : pullRequest.state === "closed" ? "×" : "●"}</span>}
        </a></div>
      {stackName && onToggleStack && <button type="button" className="ws-pr-stack-disclosure" data-state={stackExpanded ? "open" : "closed"} aria-expanded={stackExpanded} aria-label={`${stackExpanded ? "Collapse" : "Expand"} layers for ${stackName}`} onClick={onToggleStack}><Icon name="Layers" aria-hidden /></button>}
    </div>
  );
}

function PullRequestStackGroup({
  stack,
  activeThreadId,
  projectNames,
  query,
  onNavigate,
  onStateChange,
}: {
  stack: ReturnType<typeof projectPullRequestGroups>[number] & { kind: "stack" };
  activeThreadId: string | null;
  projectNames: Readonly<Record<string, string>>;
  query: string;
  onNavigate(): void;
  onStateChange: Parameters<typeof PullRequestRow>[0]["onStateChange"];
}) {
  const [expanded, setExpanded] = useState(false);
  const base = stack.layers[0];
  if (!base?.thread) return null;
  const hasLayers = stack.layers.length > 1;
  const stackName = stack.number === null ? "stack" : `stack #${stack.number}`;
  return (
    <section className={`ws-pr-stack ${expanded ? "ws-pr-stack-open" : "ws-pr-stack-closed"}`} data-state={expanded ? "open" : "closed"} aria-label={`Pull request ${stackName}, base ${stack.base}`}>
      <div className="ws-pr-stack-base-item"><PullRequestRow thread={base.thread} active={base.thread.id === activeThreadId} projectName={projectNames[base.thread.projectId] ?? "Personal"} query={query} visible stackName={stackName} stackExpanded={expanded} onToggleStack={hasLayers ? () => setExpanded((value) => !value) : undefined} onNavigate={onNavigate} onStateChange={onStateChange} /></div>
      {hasLayers && expanded && <div className="ws-pr-stack-rail">{stack.layers.slice(1).map((layer) => layer.thread ? <div key={layer.key} className="ws-pr-stack-layer-item"><PullRequestRow thread={layer.thread} active={layer.thread.id === activeThreadId} projectName={projectNames[layer.thread.projectId] ?? "Personal"} query={query} visible onNavigate={onNavigate} onStateChange={onStateChange} /></div> : null)}</div>}
    </section>
  );
}

function PullRequestReferenceRow({ thread, active, projectName, onNavigate }: { thread: PluginSidebarThread; active: boolean; projectName: string; onNavigate(): void }) {
  const actions = experimental_useSidebarThreadActions();
  const match = threadTitle(thread).match(/\bPR\s*#(\d+)\b\s*[·:-]?\s*(.*)$/i);
  if (!match) return null;
  return <button type="button" className={`ws-pr-row ws-pr-reference-row ${active ? "ws-thread-active" : ""}`} onClick={() => { actions.open(thread.id); onNavigate(); }} aria-label={`Open linked pull request reference #${match[1]}: ${match[2] || threadTitle(thread)}`}>
    <span className="ws-pr-meta"><span className="ws-pr-repository">{projectName}</span><span className="ws-pr-number">#{match[1]}</span></span>
    <strong className="ws-pr-title">{match[2] || threadTitle(thread)}</strong>
    <span className="ws-pr-context">Linked work thread · PR details unavailable</span>
  </button>;
}

const TASK_STATUSES: readonly SidebarTask["status"][] = ["backlog", "todo", "in_progress", "in_review", "done", "canceled"];

function taskStatusMeta(status: SidebarTask["status"]): { label: string; icon: string } {
  return {
    backlog: { label: "Backlog", icon: "Inbox" }, todo: { label: "To do", icon: "Circle" },
    in_progress: { label: "In progress", icon: "LoaderCircle" }, in_review: { label: "In review", icon: "Eye" },
    done: { label: "Done", icon: "CheckCircle2" }, canceled: { label: "Canceled", icon: "CircleX" },
  }[status];
}

function TaskRow({ node, siblings, showProject, reorderDisabled, dragTaskId, dropTarget, onDragTaskChange, onDragTargetChange, onDropTask, onMoveTask, onOpenThread, onUpdateStatus, updatingTaskId, selectedTaskIds, onSelect }: {
  node: TaskQueueNode; siblings: readonly TaskQueueNode[]; showProject: boolean; reorderDisabled: boolean;
  dragTaskId: string | null; dropTarget: { taskId: string; placement: "before" | "after" } | null;
  onDragTaskChange(taskId: string | null): void; onDragTargetChange(taskId: string | null, placement?: "before" | "after"): void;
  onDropTask(sourceId: string, targetId: string, placement: "before" | "after"): void; onMoveTask(taskId: string, direction: -1 | 1): void;
  onOpenThread(threadId: string, split?: boolean): void; onUpdateStatus(taskId: string, status: SidebarTask["status"]): Promise<void>; updatingTaskId: string | null;
  selectedTaskIds: ReadonlySet<string>; onSelect(taskId: string, event: ReactMouseEvent<HTMLButtonElement>): boolean;
}) {
  const { task } = node;
  const controlClick = useRef(false);
  const workers = task.linkedThreadIds;
  const status = taskStatusMeta(task.status);
  const peers = siblings.filter((candidate) => candidate.task.projectId === task.projectId && candidate.task.status === task.status && candidate.task.parentTaskId === task.parentTaskId);
  const index = peers.findIndex((candidate) => candidate.task.id === task.id);
  const interactive = (event: DragEvent<HTMLElement>) => Boolean((event.target as HTMLElement).closest("button,a,summary,[role=menu],[role=menuitem]"));
  const open = () => workers[0] && onOpenThread(workers[0], workers.length === 1);
  return <ContextMenu>
    <ContextMenuTrigger asChild>
      <article className={`ws-task-row ws-task-row-${node.role} ${selectedTaskIds.has(task.id) ? "ws-task-row-selected" : ""} ${dragTaskId === task.id ? "ws-task-dragging" : ""}`} aria-selected={selectedTaskIds.has(task.id)} data-task-role={node.role} data-task-id={task.id} data-drop-placement={dropTarget?.taskId === task.id ? dropTarget.placement : undefined} draggable={!reorderDisabled}
        onDragStart={(event) => { if (reorderDisabled || interactive(event)) { event.preventDefault(); return; } event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("text/plain", task.id); onDragTaskChange(task.id); }}
        onDragOver={(event) => { if (reorderDisabled || !dragTaskId || dragTaskId === task.id) return; const source = peers.find((candidate) => candidate.task.id === dragTaskId); if (!source) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); onDragTargetChange(task.id, event.clientY > bounds.top + bounds.height / 2 ? "after" : "before"); }}
        onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) onDragTargetChange(null); }}
        onDrop={(event) => { if (!dragTaskId || dragTaskId === task.id) return; event.preventDefault(); const bounds = event.currentTarget.getBoundingClientRect(); onDropTask(dragTaskId, task.id, event.clientY > bounds.top + bounds.height / 2 ? "after" : "before"); onDragTaskChange(null); onDragTargetChange(null); }} onDragEnd={() => { onDragTaskChange(null); onDragTargetChange(null); }}>
        <div className="ws-task-row-main">
          <button className="ws-task-open" type="button" onMouseDown={(event) => { controlClick.current = event.ctrlKey && event.button === 0; }} onClick={(event) => { if (!onSelect(task.id, event)) open(); }} onContextMenu={(event) => { if (!controlClick.current && !event.ctrlKey) return; controlClick.current = false; event.preventDefault(); onSelect(task.id, event); }} aria-disabled={!workers.length} aria-label={`Open ${task.key} in Tasks${workers.length === 1 ? " and its worker" : ""}`}><strong className="ws-task-title" title={task.title}>{task.title}</strong></button>
          <div className="ws-task-meta"><span className="ws-task-key-badge">{task.key}</span><span className={`ws-task-badge ws-task-priority-${task.priority}`}>{task.priority}</span>{task.dueDate && <span className="ws-task-badge">Due {task.dueDate}</span>}{workers.length > 0 && <span className="ws-task-badge">{workers.length} worker{workers.length === 1 ? "" : "s"}</span>}{showProject && <span className="ws-task-badge">{task.projectName}</span>}</div>
        </div>
        <div className="ws-task-actions"><label className={`ws-task-status-picker ws-task-status-${task.status}`}><Icon name={status.icon as never} aria-hidden /><span className="sr-only">Change status for {task.key}</span><select value={task.status} disabled={updatingTaskId === task.id} aria-label={`Change status for ${task.key}: ${status.label}`} onChange={(event) => void onUpdateStatus(task.id, event.target.value as SidebarTask["status"])}>{TASK_STATUSES.map((next) => <option key={next} value={next}>{taskStatusMeta(next).label}</option>)}</select></label></div>
        {node.children.length > 0 && <div className="ws-task-children" aria-label={`Execution tasks for ${task.title}`}>{node.children.map((child) => <TaskRow key={child.id} node={{ task: child, role: "execution", children: [], hasVisibleOutcomeParent: true }} siblings={node.children.map((task) => ({ task, role: "execution" as const, children: [], hasVisibleOutcomeParent: true }))} showProject={showProject} reorderDisabled={reorderDisabled} dragTaskId={dragTaskId} dropTarget={dropTarget} onDragTaskChange={onDragTaskChange} onDragTargetChange={onDragTargetChange} onDropTask={onDropTask} onMoveTask={onMoveTask} onOpenThread={onOpenThread} onUpdateStatus={onUpdateStatus} updatingTaskId={updatingTaskId} selectedTaskIds={selectedTaskIds} onSelect={onSelect} />)}</div>}
      </article>
    </ContextMenuTrigger>
    <ContextMenuContent aria-label={`Actions for ${task.key}`}><ContextMenuLabel>{task.title}</ContextMenuLabel><ContextMenuItem disabled={!workers.length} onSelect={open}>Open</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem disabled={reorderDisabled || index <= 0} onSelect={() => onMoveTask(task.id, -1)}>Move up</ContextMenuItem><ContextMenuItem disabled={reorderDisabled || index < 0 || index >= peers.length - 1} onSelect={() => onMoveTask(task.id, 1)}>Move down</ContextMenuItem></ContextMenuContent>
  </ContextMenu>;
}

type SidebarView = "work" | "queue" | "prs";

function ArchivedThreadRow({ thread, project, onUnarchive, onNavigate }: { thread: ArchivedThread; project?: { name: string; isPersonal: boolean }; onUnarchive(threadId: string): void; onNavigate(): void }) {
  const actions = experimental_useSidebarThreadActions();
  const title = thread.title || thread.titleFallback || "Untitled thread";
  const projectLabel = project?.isPersonal ? "Personal" : project?.name ?? "Project";
  return <article className="ws-thread ws-archived-thread">
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <a href="#" className="ws-thread-anchor" onClick={(event) => { event.preventDefault(); actions.open(thread.id); onNavigate(); }}>
          <Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} className="ws-project-icon" aria-label={projectLabel} />
          <span className="ws-thread-main"><span className="ws-thread-title">{title}</span><span className="ws-thread-meta"><span>{thread.environmentBranchName || projectLabel}</span><span>Archived</span></span></span>
        </a>
      </ContextMenuTrigger>
      <ContextMenuContent aria-label={`Actions for ${title}`}><ContextMenuLabel>{title}</ContextMenuLabel><ContextMenuItem onSelect={() => { actions.open(thread.id); onNavigate(); }}>Open</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem onSelect={() => onUnarchive(thread.id)}>Unarchive</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.requestDelete(thread.id)}>Delete</ContextMenuItem></ContextMenuContent>
    </ContextMenu>
  </article>;
}

function sidebarViewLabel(id: SidebarView): string {
  switch (id) {
    case "queue": return "Tasks";
    case "prs": return "PRs";
    default: return "Threads";
  }
}

function WorkThreadList(props: PluginThreadListProps) {
  const Original = props.experimental_Original ?? (() => null);
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const rpc = useRpc<typeof rpcContract>();
  const [taskLinks, setTaskLinks] = useState<Record<string, ThreadTaskLink[]>>({});
  const [view, setView] = useState<SidebarView>("work");
  const [activeThreadsOpen, setActiveThreadsOpen] = useState(true);
  const [archivedOpen, setArchivedOpen] = useState(false);
  const [archivedThreads, setArchivedThreads] = useState<ArchivedThread[]>([]);
  const [archivedThreadState, setArchivedThreadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [archivedThreadError, setArchivedThreadError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<SidebarTask[]>([]);
  const [taskState, setTaskState] = useState<"loading" | "ready" | "error">("loading");
  const [taskError, setTaskError] = useState<string | null>(null);
  const tasksRef = useRef<SidebarTask[]>([]);
  const taskMutation = useRef(0);
  const [updatingTaskId, setUpdatingTaskId] = useState<string | null>(null);
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [taskDropTarget, setTaskDropTarget] = useState<{ taskId: string; placement: "before" | "after" } | null>(null);
  const taskLinksRequest = useRef(0);
  const tasksRequest = useRef(0);
  const orderRequest = useRef(0);
  const orderMutation = useRef(0);
  const orderRef = useRef<string[]>([]);
  const [threadOrder, setThreadOrder] = useState<string[]>([]);
  const [laterThreadIds, setLaterThreadIds] = useState<Set<string>>(() => new Set());
  const [dragThreadId, setDragThreadId] = useState<string | null>(null);
  const [threadDropTarget, setThreadDropTarget] = useState<{ threadId: string; placement: "before" | "after" } | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [taskSelectionAnchorId, setTaskSelectionAnchorId] = useState<string | null>(null);
  const [selectedPullRequestIds, setSelectedPullRequestIds] = useState<Set<string>>(() => new Set());
  const [pullRequestSelectionAnchorId, setPullRequestSelectionAnchorId] = useState<string | null>(null);
  const [pullRequestStates, setPullRequestStates] = useState<Record<string, { isLoading: boolean; pullRequest: ReturnType<typeof experimental_useSidebarThreadPullRequest>["pullRequest"] }>>({});
  const [pullRequestStacks, setPullRequestStacks] = useState<Record<string, SidebarStack>>({});
  const [authoredPullRequests, setAuthoredPullRequests] = useState<AuthoredPullRequest[]>([]);
  const [authoredPullRequestState, setAuthoredPullRequestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [authoredPullRequestError, setAuthoredPullRequestError] = useState<string | null>(null);
  const [changingDraftUrl, setChangingDraftUrl] = useState<string | null>(null);
  const [authoredPullRequestRefreshKey, setAuthoredPullRequestRefreshKey] = useState(0);
  const stacksRequest = useRef(0);
  const authoredPullRequestRequest = useRef(0);

  const onPullRequestStateChange = useCallback((threadId: string, state: { isLoading: boolean; pullRequest: ReturnType<typeof experimental_useSidebarThreadPullRequest>["pullRequest"] }) => {
    const signature = (value: typeof state) => value.pullRequest ? `${value.isLoading}:${value.pullRequest.url}:${value.pullRequest.attention}` : `${value.isLoading}:none`;
    setPullRequestStates((current) => current[threadId] && signature(current[threadId]) === signature(state) ? current : { ...current, [threadId]: state });
  }, []);

  const applyOrder = useCallback((next: string[]) => {
    orderRef.current = next;
    setThreadOrder(next);
  }, []);
  const refreshSidebarOrder = useCallback(async () => {
    const request = ++orderRequest.current;
    try {
      const result = await rpc.call("getSidebarOrder", null);
      if (request === orderRequest.current) applyOrder(reconcileThreadOrder(result.threadIds, threads));
    } catch {
      // Older/temporarily rolled-back backends have no ordering RPC. Keep the
      // host order and all native behavior available.
      if (request === orderRequest.current && orderRef.current.length === 0) {
        applyOrder(reconcileThreadOrder([], threads));
      }
    }
  }, [applyOrder, rpc, threads]);
  useEffect(() => {
    void refreshSidebarOrder();
    return () => { orderRequest.current += 1; orderMutation.current += 1; };
  }, [refreshSidebarOrder]);
  const refreshLaterThreads = useCallback(async () => {
    try {
      const result = await rpc.call("getLaterThreads", null);
      setLaterThreadIds(new Set(result.threadIds));
    } catch {
      // Keep the last known Later section if the plugin backend is reloading.
    }
  }, [rpc]);
  useEffect(() => {
    void refreshLaterThreads();
  }, [refreshLaterThreads]);
  const refreshArchivedThreads = useCallback(async (force = false) => {
    setArchivedThreadState("loading"); setArchivedThreadError(null);
    try {
      const result = await rpc.call("sidebarArchivedThreads", { force });
      if (!result.available) throw new Error(result.error ?? "Archived threads are unavailable.");
      setArchivedThreads(result.threads); setArchivedThreadState("ready");
    } catch (error) {
      setArchivedThreads([]); setArchivedThreadError(error instanceof Error ? error.message : String(error)); setArchivedThreadState("error");
    }
  }, [rpc]);
  useEffect(() => {
    // Warm this slow native query after the visible sidebar is responsive, so
    // expanding Archived normally renders from the plugin/server cache.
    const timer = window.setTimeout(() => void refreshArchivedThreads(), 350);
    return () => window.clearTimeout(timer);
  }, [refreshArchivedThreads]);
  const unarchiveThread = useCallback((threadId: string) => {
    void rpc.call("unarchiveSidebarThread", { threadId }).then(() => {
      setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
      toast.success("Thread unarchived");
    }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not unarchive thread"));
  }, [rpc]);
  useRealtime(SIDEBAR_ORDER_CHANNEL, () => {
    void refreshSidebarOrder();
    void refreshLaterThreads();
  });

  const persistSidebarOrder = useCallback(async (next: string[]) => {
    const previous = orderRef.current;
    const mutation = ++orderMutation.current;
    applyOrder(next);
    try {
      const result = await rpc.call("saveSiblingOrder", { threadIds: next });
      if (mutation === orderMutation.current) {
        applyOrder(reconcileThreadOrder(result.threadIds, threads));
      }
    } catch (error) {
      if (mutation === orderMutation.current) {
        applyOrder(previous);
        toast.error(error instanceof Error ? error.message : "Could not save sidebar order");
      }
    }
  }, [applyOrder, rpc, threads]);

  const refreshTaskLinks = useCallback(async () => {
    const request = ++taskLinksRequest.current;
    try {
      const result = await rpc.call("sidebarTaskLinks", null);
      if (request !== taskLinksRequest.current) return;
      setTaskLinks(result.links);
    } catch {
      if (request === taskLinksRequest.current) setTaskLinks({});
    }
  }, [rpc]);
  useEffect(() => {
    void refreshTaskLinks();
    const timer = window.setInterval(() => void refreshTaskLinks(), 30_000);
    return () => { taskLinksRequest.current += 1; window.clearInterval(timer); };
  }, [refreshTaskLinks]);
  useEffect(() => {
    const readyThreadIds = threads.filter((thread) => pullRequestStates[thread.id]?.pullRequest).map((thread) => thread.id);
    if (!readyThreadIds.length) { setPullRequestStacks({}); return; }
    const request = ++stacksRequest.current;
    void rpc.call("sidebarPullRequestStacks", { threadIds: readyThreadIds }).then((result) => {
      if (request === stacksRequest.current) setPullRequestStacks(result.stacks);
    }).catch(() => { if (request === stacksRequest.current) setPullRequestStacks({}); });
    return () => { stacksRequest.current += 1; };
  }, [pullRequestStates, rpc, threads]);
  useEffect(() => {
    let cancelled = false;
    const loadAuthoredPullRequests = async (foreground: boolean, force = false) => {
      const request = ++authoredPullRequestRequest.current;
      if (foreground) { setAuthoredPullRequestState("loading"); setAuthoredPullRequestError(null); }
      try {
        const result = await rpc.call("sidebarAuthoredPullRequests", { force });
        if (!result.available) throw new Error(result.error ?? "GitHub authored pull requests are unavailable.");
        if (cancelled || request !== authoredPullRequestRequest.current) return;
        setAuthoredPullRequests(result.pullRequests);
        setAuthoredPullRequestState("ready");
        // Stack discovery needs one GitHub endpoint per PR. It enriches an
        // already-visible list and never blocks either first paint or refresh.
        const stackResult = await rpc.call("sidebarAuthoredPullRequestStacks", null);
        if (!cancelled && request === authoredPullRequestRequest.current && stackResult.available) setAuthoredPullRequests(stackResult.pullRequests);
      } catch (error) {
        if (cancelled || request !== authoredPullRequestRequest.current || !foreground) return;
        setAuthoredPullRequests([]); setAuthoredPullRequestState("error");
        setAuthoredPullRequestError(error instanceof Error ? error.message : String(error));
      }
    };
    // Warm every tab at mount, then quietly revalidate PRs every five minutes.
    void loadAuthoredPullRequests(true, authoredPullRequestRefreshKey > 0);
    const refreshTimer = window.setInterval(() => { void loadAuthoredPullRequests(false); }, 5 * 60_000);
    return () => { cancelled = true; window.clearInterval(refreshTimer); };
  }, [authoredPullRequestRefreshKey, rpc]);
  const refreshTasks = useCallback(async () => {
    const request = ++tasksRequest.current;
    setTaskState("loading");
    try {
      const result = await rpc.call("sidebarTasks", null);
      if (request !== tasksRequest.current) return;
      if (!result.available) throw new Error(result.error ?? "The official BB Tasks plugin is unavailable.");
      tasksRef.current = result.tasks; setTasks(result.tasks); setTaskError(null); setTaskState("ready");
    } catch (error) {
      if (request !== tasksRequest.current) return;
      setTasks([]); setTaskError(error instanceof Error ? error.message : "Could not load tasks"); setTaskState("error");
    }
  }, [rpc]);
  useEffect(() => {
    // Preload Tasks alongside PRs so changing sidebar tabs is immediate.
    void refreshTasks();
    return () => { tasksRequest.current += 1; };
  }, [refreshTasks]);

  const updateTaskStatus = useCallback(async (taskId: string, status: SidebarTask["status"]) => {
    const previous = tasksRef.current;
    const current = previous.find((task) => task.id === taskId);
    if (!current || current.status === status) return;
    const mutation = ++taskMutation.current;
    const optimistic = previous.map((task) => task.id === taskId ? { ...task, status } : task);
    tasksRef.current = optimistic; setTasks(optimistic); setUpdatingTaskId(taskId);
    try { await rpc.call("updateTaskStatus", { taskId, status }); if (mutation === taskMutation.current) await refreshTasks(); }
    catch (error) { if (mutation === taskMutation.current) { tasksRef.current = previous; setTasks(previous); toast.error(error instanceof Error ? error.message : "Could not update task"); } }
    finally { if (mutation === taskMutation.current) setUpdatingTaskId(null); }
  }, [refreshTasks, rpc]);

  const persistTaskReorder = useCallback(async (sourceId: string, targetId: string, placement: "before" | "after") => {
    if (props.searchQuery.trim()) return;
    const previous = tasksRef.current;
    const neighbors = taskReorderNeighbors(previous, sourceId, targetId, placement);
    if (!neighbors) return;
    const optimistic = reorderTaskSiblings(previous, sourceId, targetId, placement);
    const mutation = ++taskMutation.current;
    tasksRef.current = optimistic; setTasks(optimistic); setTaskDropTarget(null); setDragTaskId(null);
    try { await rpc.call("reorderTask", { taskId: sourceId, ...neighbors }); if (mutation === taskMutation.current) await refreshTasks(); }
    catch (error) { if (mutation === taskMutation.current) { tasksRef.current = previous; setTasks(previous); toast.error(error instanceof Error ? error.message : "Could not save task order"); } }
  }, [props.searchQuery, refreshTasks, rpc]);

  const moveTask = useCallback((taskId: string, direction: -1 | 1) => {
    const task = tasksRef.current.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const peers = tasksRef.current.filter((candidate) => candidate.projectId === task.projectId && candidate.status === task.status && candidate.parentTaskId === task.parentTaskId).sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    const target = peers[peers.findIndex((candidate) => candidate.id === taskId) + direction];
    if (target) void persistTaskReorder(taskId, target.id, direction < 0 ? "before" : "after");
  }, [persistTaskReorder]);

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects]);
  const effectiveOrder = useMemo(() => reconcileThreadOrder(threadOrder, threads), [threadOrder, threads]);
  const allChildrenByThread = useMemo(() => childrenByParent(threads, effectiveOrder), [effectiveOrder, threads]);
  // A parent brought forward/back carries its subtree too; this prevents a
  // child thread from being orphaned in the opposite section.
  const allLaterIds = useMemo(() => {
    const result = new Set(laterThreadIds);
    const includeDescendants = (threadId: string) => {
      for (const child of allChildrenByThread.get(threadId) ?? []) {
        if (result.has(child.id)) continue;
        result.add(child.id);
        includeDescendants(child.id);
      }
    };
    for (const threadId of laterThreadIds) includeDescendants(threadId);
    return result;
  }, [allChildrenByThread, laterThreadIds]);
  const filtered = useMemo(() => filterThreadsWithAncestors(threads.filter((thread) => !allLaterIds.has(thread.id)), projectNames, props.searchQuery), [allLaterIds, threads, projectNames, props.searchQuery]);
  const orderedRoots = useMemo(() => rootThreads(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const childrenByThread = useMemo(() => childrenByParent(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const laterThreads = useMemo(() => threads.filter((thread) => allLaterIds.has(thread.id)), [allLaterIds, threads]);
  const laterRoots = useMemo(() => rootThreads(laterThreads, effectiveOrder), [effectiveOrder, laterThreads]);
  const laterChildrenByThread = useMemo(() => childrenByParent(laterThreads, effectiveOrder), [effectiveOrder, laterThreads]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const reorderDisabled = props.searchQuery.trim().length > 0;
  const visibleThreadIds = useMemo(() => visibleThreadTreeIds(orderedRoots, childrenByThread), [childrenByThread, orderedRoots]);

  const toggleLater = useCallback((threadId: string) => {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) return;
    const subtree = new Set(visibleThreadTreeIds([thread], allChildrenByThread));
    setLaterThreadIds((current) => {
      const previous = new Set(current);
      const next = new Set(current);
      if (current.has(threadId)) subtree.forEach((id) => next.delete(id));
      else subtree.forEach((id) => next.add(id));
      void rpc.call("saveLaterThreads", { threadIds: [...next] }).then((result) => {
        setLaterThreadIds(new Set(result.threadIds));
      }).catch((error: unknown) => {
        setLaterThreadIds(previous);
        toast.error(error instanceof Error ? error.message : "Could not update Later threads");
      });
      return next;
    });
  }, [allChildrenByThread, rpc, threads]);

  // Plain click retains BB's normal open behavior. Ctrl/Cmd toggles an item,
  // while Shift extends a range through the currently visible work list.
  const selectThread = useCallback((thread: PluginSidebarThread, event: ReactMouseEvent<HTMLAnchorElement>) => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && selectionAnchorId) {
      const first = visibleThreadIds.indexOf(selectionAnchorId);
      const last = visibleThreadIds.indexOf(thread.id);
      if (first >= 0 && last >= 0) {
        setSelectedThreadIds(new Set(visibleThreadIds.slice(Math.min(first, last), Math.max(first, last) + 1)));
      } else {
        setSelectedThreadIds(new Set([thread.id]));
        setSelectionAnchorId(thread.id);
      }
      return true;
    }
    if (toggle) {
      setSelectedThreadIds((current) => {
        const next = new Set(current);
        if (next.has(thread.id)) next.delete(thread.id); else next.add(thread.id);
        return next;
      });
      setSelectionAnchorId(thread.id);
      return true;
    }
    setSelectedThreadIds(new Set([thread.id]));
    setSelectionAnchorId(thread.id);
    return false;
  }, [selectionAnchorId, visibleThreadIds]);
  const selectedArchiveRoots = useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    return [...selectedThreadIds].filter((id) => {
      for (let parent = byId.get(id)?.parentThreadId; parent; parent = byId.get(parent)?.parentThreadId) {
        if (selectedThreadIds.has(parent)) return false;
      }
      return byId.has(id);
    });
  }, [selectedThreadIds, threads]);
  const archiveSelected = useCallback(async () => {
    if (!selectedArchiveRoots.length) return;
    await Promise.all(selectedArchiveRoots.map((id) => actions.archive(id)));
    setSelectedThreadIds(new Set());
    setSelectionAnchorId(null);
  }, [actions, selectedArchiveRoots]);

  const reorder = (sourceId: string, targetId: string, placement: "before" | "after") => {
    if (reorderDisabled) return;
    const next = reorderThreadSibling(effectiveOrder, threads, sourceId, targetId, placement);
    if (next.some((id, index) => id !== effectiveOrder[index])) void persistSidebarOrder(next);
  };
  const move = (threadId: string, direction: -1 | 1) => {
    if (reorderDisabled) return;
    const next = moveThreadSibling(effectiveOrder, threads, threadId, direction);
    if (next.some((id, index) => id !== effectiveOrder[index])) void persistSidebarOrder(next);
  };

  if (status !== "ready") return <Original />;

  const filteredTasks = tasks.filter((task) => taskMatchesSearch(task, props.searchQuery));
  const taskQueue = useMemo(() => projectTaskQueue(filteredTasks), [filteredTasks]);
  const taskKeys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of filteredTasks) counts.set(task.key, (counts.get(task.key) ?? 0) + 1);
    return counts;
  }, [filteredTasks]);
  const prThreads = threads;
  const navigateToThread = (threadId: string, split = false) => { actions.open(threadId, { split }); props.onNavigate(); };
  const pullRequestByThread = Object.fromEntries(Object.entries(pullRequestStates).map(([id, state]) => [id, state.pullRequest]));
  const uniquePullRequestIds = uniquePullRequestThreadIds(prThreads.map((thread) => thread.id), pullRequestByThread);
  const visiblePullRequestIds = uniquePullRequestIds.filter((threadId) => {
    const state = pullRequestStates[threadId];
    const thread = prThreads.find((candidate) => candidate.id === threadId);
    return Boolean(state?.pullRequest && thread && matchesPullRequestSearch(thread, projectNames[thread.projectId] ?? "", state.pullRequest, props.searchQuery));
  });
  const pullRequestsSettled = prThreads.length === 0 || prThreads.every((thread) => pullRequestStates[thread.id] && !pullRequestStates[thread.id]!.isLoading);
  const pullRequestGroups = useMemo(() => projectPullRequestGroups(prThreads.flatMap((thread) => {
    const pullRequest = pullRequestStates[thread.id]?.pullRequest;
    return pullRequest ? [{ thread, pullRequest, stack: pullRequestStacks[thread.id] ?? null }] : [];
  })), [prThreads, pullRequestStacks, pullRequestStates]);
  const pullRequestReferences = useMemo(() => prThreads.filter((thread) => /\bPR\s*#\d+\b/i.test(threadTitle(thread))), [prThreads]);
  const visibleAuthoredPullRequests = useMemo(() => authoredPullRequests.filter((pullRequest) => {
    const needle = props.searchQuery.trim().toLocaleLowerCase();
    return !needle || [pullRequest.repository, `#${pullRequest.number}`, pullRequest.title, pullRequest.head, pullRequest.base, pullRequest.state].join(" ").toLocaleLowerCase().includes(needle);
  }), [authoredPullRequests, props.searchQuery]);
  const authoredPullRequestGroups = useMemo(() => {
    const groups = new Map<string, { repository: string; stacks: Map<string, SidebarStack>; ordinary: AuthoredPullRequest[] }>();
    for (const pullRequest of visibleAuthoredPullRequests) {
      const group = groups.get(pullRequest.repository) ?? { repository: pullRequest.repository, stacks: new Map<string, SidebarStack>(), ordinary: [] };
      if (pullRequest.stack) group.stacks.set(pullRequest.stack.id, pullRequest.stack);
      else group.ordinary.push(pullRequest);
      groups.set(pullRequest.repository, group);
    }
    return [...groups.values()].map((group) => ({ ...group, stacks: [...group.stacks.values()] }));
  }, [visibleAuthoredPullRequests]);
  const toggleAuthoredPullRequestDraft = useCallback((pullRequest: Omit<AuthoredPullRequest, "stack">) => {
    if (changingDraftUrl) return;
    setChangingDraftUrl(pullRequest.url);
    void rpc.call("setAuthoredPullRequestDraft", { url: pullRequest.url, draft: !pullRequest.draft }).then((result) => {
      setAuthoredPullRequests((current) => current.map((item) => {
        const updateLayer = (layer: SidebarStack["pullRequests"][number]) => layer.url === pullRequest.url ? { ...layer, draft: result.draft, state: result.draft ? "draft" : "open" } : layer;
        const stack = item.stack ? { ...item.stack, pullRequests: item.stack.pullRequests.map(updateLayer) } : null;
        return item.url === pullRequest.url ? { ...item, draft: result.draft, state: result.draft ? "draft" : "open", stack } : { ...item, stack };
      }));
    }).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not update pull request state");
    }).finally(() => setChangingDraftUrl(null));
  }, [changingDraftUrl, rpc]);
  const visibleTaskIds = taskQueue.flatMap((node) => [node.task.id, ...node.children.map((child) => child.id)]);
  const selectTask = (taskId: string, event: ReactMouseEvent<HTMLButtonElement>): boolean => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && taskSelectionAnchorId) {
      const first = visibleTaskIds.indexOf(taskSelectionAnchorId);
      const last = visibleTaskIds.indexOf(taskId);
      if (first >= 0 && last >= 0) setSelectedTaskIds(new Set(visibleTaskIds.slice(Math.min(first, last), Math.max(first, last) + 1)));
      else { setSelectedTaskIds(new Set([taskId])); setTaskSelectionAnchorId(taskId); }
      return true;
    }
    if (toggle) {
      setSelectedTaskIds((current) => { const next = new Set(current); if (next.has(taskId)) next.delete(taskId); else next.add(taskId); return next; });
      setTaskSelectionAnchorId(taskId);
      return true;
    }
    setSelectedTaskIds(new Set([taskId]));
    setTaskSelectionAnchorId(taskId);
    return false;
  };
  const visibleAuthoredPullRequestIds = [...new Set([
    ...authoredPullRequestGroups.flatMap((group) => group.stacks.flatMap((stack) => orderStackLayers(stack.pullRequests, stack.base).map((layer) => layer.url))),
    ...authoredPullRequestGroups.flatMap((group) => group.ordinary.map((pullRequest) => pullRequest.url)),
  ])];
  const selectPullRequest = (pullRequestId: string, event: ReactMouseEvent<HTMLAnchorElement>): boolean => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && pullRequestSelectionAnchorId) {
      const first = visibleAuthoredPullRequestIds.indexOf(pullRequestSelectionAnchorId);
      const last = visibleAuthoredPullRequestIds.indexOf(pullRequestId);
      if (first >= 0 && last >= 0) setSelectedPullRequestIds(new Set(visibleAuthoredPullRequestIds.slice(Math.min(first, last), Math.max(first, last) + 1)));
      else { setSelectedPullRequestIds(new Set([pullRequestId])); setPullRequestSelectionAnchorId(pullRequestId); }
      return true;
    }
    if (toggle) {
      setSelectedPullRequestIds((current) => { const next = new Set(current); if (next.has(pullRequestId)) next.delete(pullRequestId); else next.add(pullRequestId); return next; });
      setPullRequestSelectionAnchorId(pullRequestId);
      return true;
    }
    setSelectedPullRequestIds(new Set([pullRequestId]));
    setPullRequestSelectionAnchorId(pullRequestId);
    return false;
  };

  return (
    <div className="ws-list">
      <nav className="ws-view-selector" aria-label="Sidebar views">
        {(["work", "queue", "prs"] as const).map((id) => <button key={id} className={view === id ? "ws-view-active" : ""} aria-pressed={view === id} onClick={() => setView(id)}>{sidebarViewLabel(id)}</button>)}
      </nav>
      {view === "queue" && <div className="ws-view-content">
        <div className="ws-list-toolbar"><span>{filteredTasks.length} active task{filteredTasks.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedTaskIds.size > 1 && <span className="ws-selection-count" role="status">{selectedTaskIds.size} selected</span>}<button onClick={() => void refreshTasks()}>Refresh</button></span></div>
        {taskState === "loading" && <div className="ws-empty">Loading tasks…</div>}
        {taskState === "error" && <div className="ws-callout">{taskError ?? "Could not load tasks."}<button onClick={() => void refreshTasks()}>Try again</button></div>}
        {taskState === "ready" && taskQueue.map((node) => <TaskRow key={node.task.id} node={node} siblings={taskQueue} showProject={(taskKeys.get(node.task.key) ?? 0) > 1} reorderDisabled={reorderDisabled} dragTaskId={dragTaskId} dropTarget={taskDropTarget} onDragTaskChange={setDragTaskId} onDragTargetChange={(taskId, placement) => setTaskDropTarget(taskId && placement ? { taskId, placement } : null)} onDropTask={(sourceId, targetId, placement) => void persistTaskReorder(sourceId, targetId, placement)} onMoveTask={moveTask} onOpenThread={navigateToThread} onUpdateStatus={updateTaskStatus} updatingTaskId={updatingTaskId} selectedTaskIds={selectedTaskIds} onSelect={selectTask} />)}
        {taskState === "ready" && filteredTasks.length === 0 && <div className="ws-empty">{props.searchQuery ? `No tasks match “${props.searchQuery}”.` : "No active tasks."}</div>}
      </div>}
      {view === "prs" && <div className="ws-view-content">
        <div className="ws-list-toolbar"><span>{visibleAuthoredPullRequests.length} open pull request{visibleAuthoredPullRequests.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedPullRequestIds.size > 1 && <span className="ws-selection-count" role="status">{selectedPullRequestIds.size} selected</span>}<button disabled={authoredPullRequestState === "loading"} onClick={() => setAuthoredPullRequestRefreshKey((value) => value + 1)}>Refresh</button></span></div>
        {authoredPullRequestState === "loading" && <div className="ws-empty">Loading your open pull requests…</div>}
        {authoredPullRequestState === "error" && <div className="ws-callout"><strong>Could not load your open pull requests</strong><span>{authoredPullRequestError}</span></div>}
        {authoredPullRequestState === "ready" && <>{authoredPullRequestGroups.map((group) => <section className="ws-pr-repository-group" key={group.repository}><h3>{group.repository}</h3>{group.stacks.map((stack) => <AuthoredPullRequestStack key={stack.id} stack={stack} selectedIds={selectedPullRequestIds} changingDraftUrl={changingDraftUrl} onSelect={selectPullRequest} onToggleDraft={toggleAuthoredPullRequestDraft} />)}{group.ordinary.map((pullRequest) => <section className="ws-pr-stack ws-pr-stack-singleton" key={pullRequest.url}><AuthoredPullRequestRow pullRequest={pullRequest} selected={selectedPullRequestIds.has(pullRequest.url)} changingDraft={changingDraftUrl === pullRequest.url} onSelect={selectPullRequest} onToggleDraft={toggleAuthoredPullRequestDraft} /></section>)}</section>)}{visibleAuthoredPullRequests.length === 0 && <div className="ws-empty"><strong>No open pull requests</strong><span>{props.searchQuery ? `No pull requests match “${props.searchQuery}”.` : "Open pull requests you author on GitHub appear here."}</span></div>}</>}
      </div>}
      {view === "work" && <>
      <div className="ws-list-toolbar">
        <span>{filtered.length} thread{filtered.length === 1 ? "" : "s"}</span>
        <span className="ws-work-toolbar-actions">
          {selectedThreadIds.size > 1 && <><span className="ws-selection-count" role="status">{selectedThreadIds.size} selected</span><button className="ws-selection-archive" onClick={() => void archiveSelected()}>Archive selected</button></>}
          {reorderDisabled && <span className="ws-reorder-disabled" role="status">Clear search to reorder</span>}
          {props.activeProjectId && <Button className="ws-new-thread" variant="ghost" size="icon" title="New thread in project" aria-label="New thread in project" onClick={() => actions.openNewThread({ projectId: props.activeProjectId!, focusPrompt: true })}>
            <Icon name="Plus" aria-hidden />
          </Button>}
        </span>
      </div>
      <details className="ws-later ws-active-threads" open={activeThreadsOpen} onToggle={(event) => setActiveThreadsOpen(event.currentTarget.open)}>
      <summary>Active <span>{orderedRoots.length}</span></summary>
      <section className="ws-hierarchy" aria-label="Work threads">
        {orderedRoots.map((thread) => (
          <WorkThreadTree
            key={thread.id}
            thread={thread}
            childrenByThread={childrenByThread}
            taskLinks={taskLinks}
            activeThreadId={props.activeThreadId}
            selectedThreadIds={selectedThreadIds}
            laterThreadIds={allLaterIds}
            projectsById={projectsById}
            onNavigate={props.onNavigate}
            onSelect={selectThread}
            onToggleLater={toggleLater}
            orderedSiblings={orderedRoots}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={setDragThreadId}
            dropTarget={threadDropTarget}
            onDropTargetChange={setThreadDropTarget}
            onDropThread={reorder}
            onMoveThread={move}
          />
        ))}
      </section>
      </details>
      <details className="ws-later" data-drop-target={threadDropTarget?.threadId === "later" || undefined} open onDragOver={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || allLaterIds.has(sourceId)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setThreadDropTarget({ threadId: "later", placement: "after" }); }} onDrop={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || allLaterIds.has(sourceId)) return; event.preventDefault(); toggleLater(sourceId); setDragThreadId(null); setThreadDropTarget(null); }}><summary>Later <span>{laterRoots.length}</span></summary>{laterRoots.length > 0 ? <section className="ws-hierarchy" aria-label="Threads for later">{laterRoots.map((thread) => <WorkThreadTree key={thread.id} thread={thread} childrenByThread={laterChildrenByThread} taskLinks={taskLinks} activeThreadId={props.activeThreadId} selectedThreadIds={selectedThreadIds} laterThreadIds={allLaterIds} projectsById={projectsById} onNavigate={props.onNavigate} onSelect={selectThread} onToggleLater={toggleLater} orderedSiblings={laterRoots} reorderDisabled={reorderDisabled} dragThreadId={dragThreadId} onDragThreadChange={setDragThreadId} dropTarget={threadDropTarget} onDropTargetChange={setThreadDropTarget} onDropThread={reorder} onMoveThread={move} />)}</section> : <div className="ws-later-empty">Right-click a thread to move it here.</div>}</details>
      <details className="ws-later ws-archived" open={archivedOpen} onToggle={(event) => setArchivedOpen(event.currentTarget.open)}><summary>Archived <span>{archivedThreadState === "ready" ? archivedThreads.length : ""}</span></summary>{archivedThreadState === "idle" || archivedThreadState === "loading" ? <div className="ws-later-empty">Loading archived threads…</div> : archivedThreadState === "error" ? <div className="ws-callout">{archivedThreadError ?? "Could not load archived threads."}<button onClick={() => void refreshArchivedThreads(true)}>Try again</button></div> : <><div className="ws-archived-toolbar"><span>{archivedThreads.length} archived thread{archivedThreads.length === 1 ? "" : "s"}</span><button onClick={() => void refreshArchivedThreads(true)}>Refresh</button></div>{archivedThreads.length > 0 ? <section className="ws-hierarchy" aria-label="Archived threads">{archivedThreads.map((thread) => <ArchivedThreadRow key={thread.id} thread={thread} project={projectsById.get(thread.projectId)} onUnarchive={unarchiveThread} onNavigate={props.onNavigate} />)}</section> : <div className="ws-later-empty">No archived threads.</div>}</>}</details>
      {filtered.length === 0 && <div className="ws-empty">{props.searchQuery ? `No threads match “${props.searchQuery}”.` : "No active threads."}</div>}
      <details className="ws-native-fallback"><summary>Use BB’s native list</summary><Original /></details>
      </>}
    </div>
  );
}

type WorkTab = "work" | "changes" | "agents";

const WORK_TABS: readonly { id: WorkTab; label: string; description: string }[] = [
  { id: "work", label: "Work", description: "Outcome, execution tasks, goal, and plan" },
  { id: "changes", label: "PR & Changes", description: "Pull request, stack, branch, and working-tree state" },
  { id: "agents", label: "Agents", description: "Delegated child threads" },
];

function readableStatus(status: string): string {
  return status.replaceAll("-", " ").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function CurrentPullRequestCard({ pullRequest }: { pullRequest: CurrentPullRequestView }) {
  const checks = pullRequest.checks.totalCount === 0
    ? "No checks reported"
    : `${pullRequest.checks.passedCount}/${pullRequest.checks.totalCount} checks ${readableStatus(pullRequest.checks.state)}`;
  return (
    <article className="ws-card ws-current-pr-card">
      <div className="ws-card-heading"><strong>Current pull request</strong><span className={`ws-pill ws-pr-${pullRequest.attention}`}>{readableStatus(pullRequest.attention)}</span></div>
      <h3><a href={pullRequest.url} target="_blank" rel="noreferrer">#{pullRequest.number} {pullRequest.title}</a></h3>

      <div className="ws-card-meta"><span>{pullRequest.head}</span><span>{readableStatus(pullRequest.state)}</span><span>{checks}</span><span>Review: {readableStatus(pullRequest.review.state)}</span></div>
      <p className="ws-card-note">This PR directly merges into <strong>{pullRequest.base}</strong>. Mergeability: {readableStatus(pullRequest.mergeability.state)}.</p>
    </article>
  );
}

function WorkPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const actions = experimental_useSidebarThreadActions();
  const [tab, setTab] = useState<WorkTab>("work");
  const [context, setContext] = useState<Extract<Awaited<ReturnType<typeof rpc.call>>, { tasksAvailable: boolean }> | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [updatingTask, setUpdatingTask] = useState<string | null>(null);
  const requestId = useRef(0);
  const [taskTitle, setTaskTitle] = useState("");
  const [createTaskState, setCreateTaskState] = useState<"idle" | "working" | "error">("idle");
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const next = await rpc.call("getWorkContext", { threadId });
      if (request !== requestId.current) return;
      setContext(next);
      setTaskTitle((current) => current || next.currentThread.title);
      setCreateTaskState("idle");
      setCreateTaskError(null);
    } catch (caught) {
      if (request !== requestId.current) return;
      setContext(null);
      setError(caught instanceof Error ? caught.message : "Could not load work context");
    } finally {
      if (request === requestId.current) setLoading(false);
    }
  }, [rpc, threadId]);
  useEffect(() => { void refresh(); return () => { requestId.current += 1; }; }, [refresh]);
  useRealtime("work-sidebar:changed", () => { void refresh(); });

  const createTask = async () => {
    if (!context?.tasksAvailable || !taskTitle.trim() || createTaskState === "working") return;
    setCreateTaskState("working");
    setCreateTaskError(null);
    try {
      await rpc.call("createWorkTask", { threadId, title: taskTitle.trim(), description: "Created from the Work sidebar.", parentTaskId: null });
      setTaskTitle(""); toast.success("Task created and attached"); await refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not create task";
      setCreateTaskState("error");
      setCreateTaskError(message);
      toast.error(message);
    }
  };

  const selectedTab = WORK_TABS.find((candidate) => candidate.id === tab) ?? WORK_TABS[0]!;
  const selectTab = (next: WorkTab) => setTab(next);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = WORK_TABS.findIndex((candidate) => candidate.id === tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? WORK_TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + WORK_TABS.length) % WORK_TABS.length;
    const next = WORK_TABS[nextIndex]!;
    selectTab(next.id);
    window.requestAnimationFrame(() => document.getElementById(`ws-tab-${next.id}`)?.focus());
  };
  const tabPanelId = `ws-panel-${selectedTab.id}`;
  const outcomeTask = context?.outcome ?? context?.tasks[0] ?? null;
  const executionTasks = context?.executionTasks?.length ? context.executionTasks : (context?.subtasks ?? []);
  const bindings = context?.bindings ?? [];

  return (
    <div className="ws-panel">
      <header className="ws-panel-header">
        <div className="ws-panel-heading">
          <Icon name="ListTodo" className="ws-panel-icon" aria-hidden />
          <div><strong>Current work</strong><span>{context?.currentThread.title ?? "Active thread"}</span></div>
        </div>
        <button type="button" className="ws-icon-button" aria-label="Refresh work context" title="Refresh work context" onClick={() => void refresh()} disabled={loading}>↻</button>
      </header>
      <nav className="ws-tabs" role="tablist" aria-label="Work context views">
        {WORK_TABS.map((candidate) => (
          <button
            key={candidate.id}
            id={`ws-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            aria-controls={`ws-panel-${candidate.id}`}
            tabIndex={tab === candidate.id ? 0 : -1}
            className={tab === candidate.id ? "ws-tab-active" : ""}
            title={candidate.description}
            onClick={() => selectTab(candidate.id)}
            onKeyDown={onTabKeyDown}
          >{candidate.label}</button>
        ))}
      </nav>
      <div className="ws-panel-body" role="tabpanel" id={tabPanelId} aria-labelledby={`ws-tab-${selectedTab.id}`} tabIndex={0}>
        {loading && <div className="ws-empty" role="status" aria-live="polite">Loading work context…</div>}
        {!loading && error && <div className="ws-callout" role="alert"><span>{error}</span><button type="button" onClick={() => void refresh()}>Try again</button></div>}
        {!loading && context && tab === "work" && (
          <div className="ws-section-stack">
            <header><div><h2>Work</h2><span>{outcomeTask?.key ?? "No outcome"}</span></div><span className="ws-section-count">{executionTasks.length} execution task{executionTasks.length === 1 ? "" : "s"}</span></header>
            {!context.tasksAvailable && <div className="ws-callout"><span>Tasks are unavailable right now. Your thread is still available here, and you can create and attach its task when Tasks reconnects.</span><button type="button" onClick={() => void refresh()}>Check again</button></div>}
            {outcomeTask && (
              <article key={outcomeTask.id} className="ws-card">
                <div className="ws-card-heading"><strong>{outcomeTask.key}</strong><span className={`ws-pill ws-pill-${outcomeTask.status}`}>{readableStatus(outcomeTask.status)}</span></div>
                <h3>{outcomeTask.title}</h3>
                <div className="ws-card-meta"><span>{readableStatus(outcomeTask.priority)} priority</span>{outcomeTask.dueDate && <span>Due {outcomeTask.dueDate}</span>}</div>
                <div className="ws-card-actions">
                  {outcomeTask.status !== "in_review" && outcomeTask.status !== "done" && outcomeTask.status !== "canceled" && context.tasksAvailable && <Button size="sm" variant="outline" disabled={updatingTask === outcomeTask.id} onClick={async () => {
                    setUpdatingTask(outcomeTask.id);
                    try { await rpc.call("updateWorkTask", { taskId: outcomeTask.id, status: "in_review" }); await refresh(); }
                    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update task"); }
                    finally { setUpdatingTask(null); }
                  }}>{updatingTask === outcomeTask.id ? "Updating…" : "Mark in review"}</Button>}
                </div>
              </article>
            )}
            {!outcomeTask && (
              <div className="ws-create-task">
                <div><h3>No current outcome yet</h3><p>Create the durable top-level outcome task for this root work item.</p></div>
                <Input disabled={!context.tasksAvailable || createTaskState === "working"} aria-label="Outcome-oriented task title" placeholder="Outcome-oriented task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createTask(); }} />
                <Button size="sm" disabled={!context.tasksAvailable || createTaskState === "working" || !taskTitle.trim()} onClick={() => void createTask()}>{createTaskState === "working" ? "Creating and attaching…" : "Create and attach task"}</Button>
                {createTaskError && <div className="ws-inline-error" role="alert">{createTaskError}</div>}
              </div>
            )}
            <header><div><h2>Execution tasks</h2><span>Direct child tasks</span></div><span className="ws-section-count">{executionTasks.length}</span></header>
            {executionTasks.length > 0 ? <div className="ws-subtask-list">{executionTasks.map((task) => { const binding = bindings.find((candidate) => candidate.executionTaskId === task.id); return <div key={task.id} className="ws-subtask ws-subtask-card"><span className={`ws-status-dot ws-status-dot-${task.status}`}>{task.status === "done" ? "✓" : "•"}</span><span><strong>{task.title}</strong><small>{task.key} · {readableStatus(task.status)}</small>{binding && <small>{binding.mode ? `${readableStatus(binding.mode)} owner` : "Unowned"} · {readableStatus(binding.dispatchState)}{binding.recoveryMessage ? ` · ${binding.recoveryMessage}` : ""}</small>}</span><span className="ws-subtask-status">{readableStatus(task.status)}</span></div>; })}</div> : <div className="ws-empty">No execution tasks are attached to this outcome yet.</div>}
            {context.goal && <article className="ws-card ws-goal"><div className="ws-card-heading"><strong>Goal</strong><span>{readableStatus(context.goal.status)}</span></div><h3>{context.goal.objective}</h3>{goalProgressPercent(context.goal) !== null && <div className="ws-progress" role="progressbar" aria-label="Goal token usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalProgressPercent(context.goal)!}><span style={{ width: `${goalProgressPercent(context.goal)}%` }} /></div>}</article>}
            <header><div><h2>Plan</h2><span>Current provider steps</span></div><span className="ws-section-count">{context.todos.filter((item) => item.status === "completed").length} / {context.todos.length}</span></header>
            <div className="ws-plan">
              {context.todos.map((item) => <div key={item.id} className={`ws-plan-item ws-plan-${item.status}`}><span aria-hidden="true">{item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}</span><span>{item.text}</span><span className="sr-only">{readableStatus(item.status)}</span></div>)}
              {context.todos.length === 0 && <div className="ws-empty">No active agent plan.</div>}
            </div>
          </div>
        )}
        {!loading && context && tab === "changes" && (
          <div className="ws-section-stack">
            <header><div><h2>PR & Changes</h2><span>{context.repository.branch ?? "No workspace branch"}</span></div><span className="ws-section-count">{context.currentPullRequest ? `#${context.currentPullRequest.number}` : "No PR"}</span></header>
            <article className="ws-card ws-repository-card"><div className="ws-card-heading"><strong>{context.repository.branch ?? "Repository"}</strong><span className={`ws-pill ${context.repository.hasUncommittedChanges ? "ws-pr-changes_requested" : ""}`}>{context.repository.hasUncommittedChanges ? "Uncommitted changes" : context.repository.outcome === "available" ? "Clean" : "Unavailable"}</span></div>{context.repository.outcome === "available" ? <><div className="ws-card-meta"><span>Base {context.repository.base ?? "—"}</span><span>{context.repository.ahead} ahead · {context.repository.behind} behind</span></div>{context.repository.changedFiles.length > 0 && <div className="ws-file-list">{context.repository.changedFiles.map((file) => <span key={file.path}><b>{file.status}</b> {file.path}</span>)}</div>}</> : <p className="ws-card-note">{context.repository.message ?? "Repository status is unavailable."}</p>}</article>
            {context.currentPullRequest && <CurrentPullRequestCard pullRequest={context.currentPullRequest} />}
            {context.stack ? <>
              <ol className="ws-stack-rail" aria-label={`Stack #${context.stack.number}`}>
              {orderStackLayers(context.stack.pullRequests, context.stack.base).map((pr) => <li key={pr.number}><a href={pr.url} target="_blank" rel="noreferrer" className="ws-stack-layer" aria-current={pr.number === context.stack?.currentPullRequest ? "page" : undefined}><span className="ws-stack-node" aria-hidden="true">{pr.state === "merged" ? "✓" : pr.draft ? "○" : "●"}</span><span><strong>#{pr.number} {pr.title}</strong><small>{pr.head} · {pr.draft ? "Draft" : readableStatus(pr.state)}</small></span><span className="ws-stack-layer-action">Open ↗</span></a></li>)}
              </ol>
            </> : context.currentPullRequest ? <div className="ws-callout"><span>{context.stackUnavailableReason ?? "This pull request is not part of a Stack."}</span><small>Showing the pull request directly; Stack discovery does not block its checks, review, or mergeability.</small>{context.stackUnavailableReason && <button type="button" onClick={() => void refresh()}>Retry Stack discovery</button>}</div> : <div className="ws-empty">No pull request is linked to this thread.</div>}
          </div>
        )}
        {!loading && context && tab === "agents" && (
          <div className="ws-section-stack">
            <header><div><h2>Agents</h2><span>Child threads resolved by BB</span></div><span className="ws-section-count">{context.children.length}</span></header>
            <div className="ws-current-agent"><span className="ws-status-dot ws-status-dot-running">●</span><span><strong>Current thread</strong><small>{context.currentThread.providerId} · {readableStatus(context.currentThread.runtimeStatus)}</small></span></div>
            {context.children.map((child) => { const childTasks = ((child as typeof child & { tasks?: readonly NonNullable<typeof child.task>[] }).tasks ?? (child.task ? [child.task] : [])); const state = agentProjectionState(child.status, childTasks[0]?.status ?? null); const owned = bindings.filter((binding) => binding.ownerThreadId === child.id); return <button key={child.id} className={`ws-agent-card ws-agent-${state}`} style={{ marginLeft: `${Math.min(child.depth - 1, 4) * 0.65}rem` }} onClick={() => actions.open(child.id, { split: true })} aria-label={`Open ${child.title} in split`}><span className={`ws-agent-state ws-agent-state-${state}`} aria-hidden="true">●</span><span><strong>{child.title}</strong><small>{child.providerId} · {readableStatus(child.runtimeStatus)} · {readableStatus(state)}</small>{childTasks.map((task) => <small key={task.key}>{task.key} · {task.status === "in_review" ? "Review-ready" : readableStatus(task.liveStatus)}</small>)}{owned.map((binding) => <small key={`${binding.executionTaskId}:${binding.idempotencyKey}`}>Owned execution · {readableStatus(binding.mode ?? "unowned")} · {readableStatus(binding.dispatchState)}{binding.recoveryMessage ? ` · ${binding.recoveryMessage}` : ""}</small>)}</span><span className="ws-agent-open">Open split ↗</span></button>; })}
            {context.children.length === 0 && <div className="ws-empty">No delegated child threads are attached to this thread.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkContextHeaderAction({ isCompactViewport }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  return <button type="button" className="ws-header-action" aria-label="Open Current Work" title="Open Current Work" onClick={() => { navigate.openThreadPanel({ actionId: "work-context" }); }}>{isCompactViewport ? "▣" : "Work"}</button>;
}

function TrackWorkAction() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const view = useComposerView();
  if (view.scope.kind !== "thread") return null;
  const threadId = view.scope.threadId;
  const track = async () => {
    const title = view.draft.text.trim().split("\n")[0]?.slice(0, 100) || "New work";
    try {
      const result = await rpc.call("createWorkTask", { threadId, title, description: view.draft.text, parentTaskId: null });
      composer.updateText((current) => `Work through ${result.task.key}: ${result.task.title}.\n\n${current}`);
      toast.success(`${result.task.key} created and attached`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not track work"); }
  };
  return <button className="ws-track-action" aria-label="Track this work as a task" title="Create and attach a BB task before sending" onClick={() => void track()}>Task</button>;
}

export default definePluginApp((app) => {
  app.slots.experimental_threadList({
    id: "work-queue", title: "Tasks", description: "Global outcome and execution task queue.", component: WorkThreadList,
  });
  app.slots.threadPanelAction({
    id: "work-context", title: "Current Work", icon: "ListTodo", component: WorkPanel, layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "work-context-header", title: "Current Work", component: WorkContextHeaderAction,
  });
  app.composer.customize({
    id: "task-first", scopes: ["thread"], actions: [{ id: "track-work", component: TrackWorkAction }],
  });
});
