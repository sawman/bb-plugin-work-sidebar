import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
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
import "react-diff-view/style/index.css";
import { CurrentPullRequestCard as ChangesPullRequestCard, StackBranchRow as ChangesStackBranchRow, WorkingTreeDiff as ChangesWorkingTreeDiff, type StackBranchSignals } from "@/components/work/changes";
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
import { ArchivedThreadRow, type ArchivedThread } from "@/components/threads/archived-thread-row";
import { LinearCard } from "@/components/work/linear-card";
import { AuthoredPullRequestRow as AuthoredPrRow, AuthoredPullRequestStack as AuthoredPrStack, type AuthoredPullRequest } from "@/components/threads/authored-pull-requests";
import { TaskRow as SidebarTaskRow } from "@/components/threads/task-row";
import type { rpcContract } from "./contracts";
import {
  childrenByParent,
  filterThreadsWithAncestors,
  moveThreadSibling,
  normalizeIndicator,
  reconcileThreadOrder,
  reorderThreadSibling,
  rootThreads,
  threadTitle,
  type ThreadTaskLink,
  reorderTaskSiblings,
  taskReorderNeighbors,
  orderTaskLinksByRelevance,
  projectTaskQueue,
  taskMatchesSearch,
  type SidebarTask,
  agentProjectionState,
  goalProgressPercent,
  orderStackLayers,
  readableStatus,
  runtimeStatusPresentation,
  type SidebarStack,
} from "./work-model";
import { Icon } from "@/components/ui/icon";
import "./app.css";
import "./scrollbar.css";
import "./views.css";

const SIDEBAR_ORDER_CHANNEL = "sidebar-order:changed";
type SidebarThreadGroup = { id: string; name: string; threadIds: string[] };

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

function threadIsWorking(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return indicator === "runtime" || indicator === "workflow" || indicator === "background-agent" || indicator === "background-command" || indicator === "goal" || indicator === "plan-mode" || indicator === "working-draft";
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
  activeChildren,
  childrenExpanded,
  selected,
  groupId,
  groups,
  onToggleChildren,
  onSelect,
  onMoveToGroup,
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
  activeChildren: number;
  childrenExpanded: boolean;
  selected: boolean;
  groupId: string | null;
  groups: readonly SidebarThreadGroup[];
  onToggleChildren(): void;
  onSelect(thread: PluginSidebarThread, event: ReactMouseEvent<HTMLAnchorElement>): boolean;
  onMoveToGroup(threadId: string, groupId: string | null): void;
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
  const composerView = useComposerView();
  const controlClick = useRef(false);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(threadTitle(thread));
  const projectLabel = project?.isPersonal ? "Personal" : project?.name ?? "Project";
  const title = threadTitle(thread);
  const indicator = normalizeIndicator(String(thread.indicator));
  const working = threadIsWorking(thread);
  // The plugin SDK exposes the active composer scope and its structured draft.
  // Match the native row's precedence: running work wins; otherwise an
  // unsent draft owns the one trailing status slot.
  const hasComposerDraft = composerView.scope.kind === "thread" && composerView.scope.threadId === thread.id && !composerView.draft.isEmpty;
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
  const archiveTree = () => { if (groupId) onMoveToGroup(thread.id, null); actions.archive(thread.id); };
  const requestDeleteTree = () => actions.requestDelete(thread.id);
  const unifiedDragCleanup = useRef<(() => void) | null>(null);
  useEffect(() => () => unifiedDragCleanup.current?.(), []);
  // One row-wide pointer gesture: while it remains in the sidebar it reorders;
  // once it leaves, BB's native handler (called first) owns open/split.
  const startUnifiedDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    splitProps.onPointerDown?.(event);
    if (reorderDisabled || event.button !== 0 || (event.target as HTMLElement).closest("button,input,textarea")) return;
    const pointerId = event.pointerId;
    let active = false;
    const clear = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", finish); window.removeEventListener("pointercancel", finish); unifiedDragCleanup.current = null; onDragThreadChange(null); onDropTargetChange(null); };
    const targetAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-ws-thread-id]")?.dataset.wsThreadId ?? null;
    const zoneAt = (x: number, y: number) => document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-ws-thread-drop-zone]")?.dataset.wsThreadDropZone ?? null;
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (!active && Math.hypot(moveEvent.clientX - event.clientX, moveEvent.clientY - event.clientY) < 5) return;
      const sourceId = thread.id;
      const targetId = targetAt(moveEvent.clientX, moveEvent.clientY);
      const zone = zoneAt(moveEvent.clientX, moveEvent.clientY);
      if (!targetId && zone && zone !== groupId) {
        active = true;
        onDragThreadChange(sourceId);
        onDropTargetChange({ threadId: zone, placement: "after" });
        moveEvent.preventDefault();
        return;
      }
      if (!targetId || targetId === sourceId || !canDropThread(sourceId)) { if (active) { onDragThreadChange(null); onDropTargetChange(null); } return; }
      const target = document.querySelector<HTMLElement>(`[data-ws-thread-id="${CSS.escape(targetId)}"]`);
      if (!target) return;
      active = true;
      const bounds = target.getBoundingClientRect();
      onDragThreadChange(sourceId);
      onDropTargetChange({ threadId: targetId, placement: moveEvent.clientY > bounds.top + bounds.height / 2 ? "after" : "before" });
      moveEvent.preventDefault();
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerId && active) {
        const zone = zoneAt(finishEvent.clientX, finishEvent.clientY);
        const targetId = targetAt(finishEvent.clientX, finishEvent.clientY);
        if (!targetId && zone === "archive") archiveTree();
        else if (!targetId && zone && zone !== groupId) onMoveToGroup(thread.id, zone === "active" ? null : zone);
        else {
        const target = targetId ? document.querySelector<HTMLElement>(`[data-ws-thread-id="${CSS.escape(targetId)}"]`) : null;
        if (targetId && target && targetId !== thread.id && canDropThread(thread.id)) {
          const bounds = target.getBoundingClientRect();
          onDropThread(thread.id, targetId, finishEvent.clientY > bounds.top + bounds.height / 2 ? "after" : "before");
        }
        }
      }
      clear();
    };
    unifiedDragCleanup.current?.();
    unifiedDragCleanup.current = clear;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };

  return (
    <div
      className={`ws-thread ${active ? "ws-thread-active" : ""} ${selected ? "ws-thread-selected" : ""} ${dragThreadId === thread.id ? "ws-thread-dragging" : ""}`}
      data-ws-thread-id={thread.id}
      data-depth={thread.parentThreadId ? "child" : "root"}
      data-drop-placement={dropTarget?.threadId === thread.id ? dropTarget.placement : undefined}
      onPointerDown={startUnifiedDrag}
    >
      {renaming ? (
        <div className="ws-rename">
          <Input
            autoFocus value={draftTitle} aria-label="Thread title"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
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
              data-sidebar-thread-shortcut-target=""
              data-sidebar-thread-id={thread.id}
              data-sidebar-thread-parent-id={thread.parentThreadId ?? ""}
              className={`ws-thread-anchor ${children > 0 ? "ws-thread-has-children" : ""}`}
              title={isAvailable ? "Drag into the main area to open; drop at an edge to split" : undefined}
              aria-selected={selected}
              onMouseDown={(event) => { controlClick.current = event.ctrlKey && event.button === 0; }}
              onClick={(event) => {
                event.preventDefault();
                if (!onSelect(thread, event)) open(false);
              }}
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
              <span className="ws-thread-leading">
                {children > 0 ? <button type="button" className={`ws-thread-agent-badge ${childrenExpanded ? "ws-thread-agent-badge-expanded" : ""}`} aria-label={`${children} child agent${children === 1 ? "" : "s"}${childrenExpanded ? ", expanded" : ", collapsed"}`} aria-expanded={childrenExpanded} onPointerDown={(event) => event.stopPropagation()} onClick={(event) => { event.preventDefault(); event.stopPropagation(); onToggleChildren(); }}><Icon name="Bot" className={activeChildren ? "ws-child-agent-working" : undefined} aria-hidden /><small>{children}</small></button> : <span className="ws-thread-agent-placeholder" aria-hidden />}
              </span>
              <span className="ws-thread-main">
                <span className={`ws-thread-title ${thread.isUnread ? "ws-unread" : ""}`}>{title}</span>
                <span className="ws-thread-meta">
                  {pullRequest && <span className={`ws-pr-meta ws-thread-token ws-thread-pr-token ws-thread-pr-${pullRequestTone}`} title={`PR #${pullRequest.number} · ${pullRequest.attention === "ready_to_merge" ? "Ready to merge" : pullRequest.state}`}><Icon name={pullRequestTone === "closed" ? "X" : pullRequest.attention === "ready_to_merge" ? "Check" : "GitPullRequest"} aria-hidden /><span>#{pullRequest.number}</span></span>}
                  <span className="ws-thread-worktree" title={`${projectLabel} ${project?.isPersonal ? "work" : "project"} · ${thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}`}><Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} aria-hidden /><span>{thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}</span></span>
                  {orderTaskLinksByRelevance(taskLinks ?? []).map((taskLink) => <span className="ws-task-link" key={`${taskLink.task.id}:${taskLink.role}`} title={`${taskLink.task.title} · ${taskLink.task.key}`}><Icon name="ListTodo" aria-hidden /><small className="ws-task-key">{taskLink.task.key}</small></span>)}
                  {pullRequestLoading && <span className="ws-pr-meta" aria-label="Pull request loading">PR loading…</span>}
                </span>
              </span>
              <span className="ws-thread-trailing">
                {hasComposerDraft && <Icon name="Pencil" className="ws-composer-draft" aria-label="Unsent draft" />}
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
            <ContextMenuItem disabled={groupId === null} onSelect={() => onMoveToGroup(thread.id, null)}>Active</ContextMenuItem>
            {groups.map((group) => <ContextMenuItem key={group.id} disabled={group.id === groupId} onSelect={() => onMoveToGroup(thread.id, group.id)}>{group.name}</ContextMenuItem>)}
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
  groupIds,
  groups,
  projectsById,
  onNavigate,
  onSelect,
  onMoveToGroup,
  orderedSiblings,
  reorderDisabled,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  onDropThread,
  onMoveThread,
  subtextRefreshKey,
  depth = 0,
}: {
  thread: PluginSidebarThread;
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  activeThreadId: string | null;
  selectedThreadIds: ReadonlySet<string>;
  groupIds: ReadonlyMap<string, string>;
  groups: readonly SidebarThreadGroup[];
  projectsById: ReadonlyMap<string, { name: string; isPersonal: boolean }>;
  onNavigate(): void;
  onSelect(thread: PluginSidebarThread, event: ReactMouseEvent<HTMLAnchorElement>): boolean;
  onMoveToGroup(threadId: string, groupId: string | null): void;
  orderedSiblings: readonly PluginSidebarThread[];
  reorderDisabled: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  dropTarget: { threadId: string; placement: "before" | "after" } | null;
  onDropTargetChange(target: { threadId: string; placement: "before" | "after" } | null): void;
  onDropThread(sourceId: string, targetId: string, placement: "before" | "after"): void;
  onMoveThread(threadId: string, direction: -1 | 1): void;
  subtextRefreshKey: number;
  depth?: number;
}) {
  const children = childrenByThread.get(thread.id) ?? [];
  const activeChildren = children.filter(threadIsWorking).length;
  // New child agents should not take over the sidebar; reveal each subtree
  // only when the user deliberately opens its disclosure.
  const [childrenExpanded, setChildrenExpanded] = useState(false);
  const siblingIndex = orderedSiblings.findIndex((sibling) => sibling.id === thread.id);
  return (
    <>
      <ThreadRow key={`${thread.id}:${subtextRefreshKey}`}
        thread={thread}
        active={thread.id === activeThreadId}
        taskLinks={taskLinks[thread.id]}
        children={children.length}
        activeChildren={activeChildren}
        childrenExpanded={childrenExpanded}
        selected={selectedThreadIds.has(thread.id)}
        groupId={groupIds.get(thread.id) ?? null}
        groups={groups}
        onToggleChildren={() => setChildrenExpanded((expanded) => !expanded)}
        onSelect={onSelect}
        onMoveToGroup={onMoveToGroup}
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
            groupIds={groupIds}
            groups={groups}
            projectsById={projectsById}
            onNavigate={onNavigate}
            onSelect={onSelect}
            onMoveToGroup={onMoveToGroup}
            orderedSiblings={children}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={onDragThreadChange}
            dropTarget={dropTarget}
            onDropTargetChange={onDropTargetChange}
            onDropThread={onDropThread}
            onMoveThread={onMoveThread}
            subtextRefreshKey={subtextRefreshKey}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  );
}

type SidebarView = "work" | "queue" | "prs";

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
  const [threadListMode, setThreadListMode] = useState<"enhanced" | "native">("enhanced");
  const [threadSettingsOpen, setThreadSettingsOpen] = useState(false);
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
  const [threadGroups, setThreadGroups] = useState<SidebarThreadGroup[]>([]);
  const [dragThreadId, setDragThreadId] = useState<string | null>(null);
  const [threadDropTarget, setThreadDropTarget] = useState<{ threadId: string; placement: "before" | "after" } | null>(null);
  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(() => new Set());
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [taskSelectionAnchorId, setTaskSelectionAnchorId] = useState<string | null>(null);
  const [selectedPullRequestIds, setSelectedPullRequestIds] = useState<Set<string>>(() => new Set());
  const [pullRequestSelectionAnchorId, setPullRequestSelectionAnchorId] = useState<string | null>(null);
  const [authoredPullRequests, setAuthoredPullRequests] = useState<AuthoredPullRequest[]>([]);
  const [authoredPullRequestState, setAuthoredPullRequestState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [authoredPullRequestError, setAuthoredPullRequestError] = useState<string | null>(null);
  const [changingDraftUrl, setChangingDraftUrl] = useState<string | null>(null);
  const [authoredPullRequestRefreshKey, setAuthoredPullRequestRefreshKey] = useState(0);
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);
  const authoredPullRequestRequest = useRef(0);

  useEffect(() => {
    void rpc.call("getThreadListMode", null).then((result) => setThreadListMode(result.mode)).catch(() => undefined);
  }, [rpc]);
  const setSavedThreadListMode = (mode: "enhanced" | "native") => {
    setThreadListMode(mode); setThreadSettingsOpen(false);
    void rpc.call("saveThreadListMode", { mode }).catch(() => toast.error("Could not save thread-list preference."));
  };

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
  const refreshThreadGroups = useCallback(async () => {
    try {
      const result = await rpc.call("getThreadGroups", null);
      setThreadGroups(result.groups);
    } catch {
      // Keep the last known custom groups while the plugin backend reloads.
    }
  }, [rpc]);
  useEffect(() => {
    void refreshThreadGroups();
  }, [refreshThreadGroups]);
  const refreshArchivedThreads = useCallback(async (force = false) => {
    setArchivedThreadState("loading"); setArchivedThreadError(null);
    try {
      const result = await rpc.call("sidebarArchivedThreads", { force });
      if (!result.available) throw new Error(result.error ?? "Archive threads are unavailable.");
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
  const saveThreadGroups = useCallback((next: SidebarThreadGroup[], previous = threadGroups) => {
    setThreadGroups(next);
    void rpc.call("saveThreadGroups", { groups: next }).then((result) => {
      setThreadGroups(result.groups);
    }).catch((error: unknown) => {
      setThreadGroups(previous);
      toast.error(error instanceof Error ? error.message : "Could not save thread groups");
    });
  }, [rpc, threadGroups]);
  const unarchiveThread = useCallback((threadId: string, destination: string | null) => {
    void rpc.call("unarchiveSidebarThread", { threadId }).then(async () => {
      if (destination) saveThreadGroups(threadGroups.map((group) => group.id === destination ? { ...group, threadIds: [...new Set([...group.threadIds, threadId])] } : group));
      setArchivedThreads((current) => current.filter((thread) => thread.id !== threadId));
      toast.success(`Moved to ${destination ? threadGroups.find((group) => group.id === destination)?.name ?? "group" : "Active"}`);
    }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not unarchive thread"));
  }, [rpc, saveThreadGroups, threadGroups]);
  useRealtime(SIDEBAR_ORDER_CHANNEL, () => {
    void refreshSidebarOrder();
    void refreshThreadGroups();
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
  const refreshThreadDetails = useCallback(async () => {
    void refreshSidebarOrder();
    void refreshThreadGroups();
    void refreshTaskLinks();
    void refreshArchivedThreads(true);
    setSubtextRefreshKey((current) => current + 1);
  }, [refreshArchivedThreads, refreshThreadGroups, refreshSidebarOrder, refreshTaskLinks]);
  useEffect(() => {
    void refreshTaskLinks();
    const timer = window.setInterval(() => void refreshTaskLinks(), 30_000);
    return () => { taskLinksRequest.current += 1; window.clearInterval(timer); };
  }, [refreshTaskLinks]);
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
  // A group follows the whole thread subtree, just as archive does. This
  // keeps child agents from being stranded in a different status section.
  const threadGroupIds = useMemo(() => {
    const result = new Map<string, string>();
    const includeDescendants = (threadId: string, groupId: string) => {
      if (result.has(threadId)) return;
      result.set(threadId, groupId);
      for (const child of allChildrenByThread.get(threadId) ?? []) includeDescendants(child.id, groupId);
    };
    for (const group of threadGroups) for (const threadId of group.threadIds) includeDescendants(threadId, group.id);
    return result;
  }, [allChildrenByThread, threadGroups]);
  const allGroupedIds = useMemo(() => new Set(threadGroupIds.keys()), [threadGroupIds]);
  const archivedThreadIds = useMemo(() => new Set(archivedThreads.map((thread) => thread.id)), [archivedThreads]);
  const filtered = useMemo(() => filterThreadsWithAncestors(threads.filter((thread) => !allGroupedIds.has(thread.id)), projectNames, props.searchQuery), [allGroupedIds, threads, projectNames, props.searchQuery]);
  const orderedRoots = useMemo(() => rootThreads(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const childrenByThread = useMemo(() => childrenByParent(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const groupedThreadTrees = useMemo(() => new Map(threadGroups.map((group) => {
    const groupThreads = threads.filter((thread) => threadGroupIds.get(thread.id) === group.id);
    return [group.id, { roots: rootThreads(groupThreads, effectiveOrder), children: childrenByParent(groupThreads, effectiveOrder) }] as const;
  })), [effectiveOrder, threadGroupIds, threadGroups, threads]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const reorderDisabled = props.searchQuery.trim().length > 0;
  const visibleThreadIds = useMemo(() => visibleThreadTreeIds(orderedRoots, childrenByThread), [childrenByThread, orderedRoots]);

  const moveThreadToGroup = useCallback((threadId: string, destination: string | null) => {
    const thread = threads.find((candidate) => candidate.id === threadId);
    if (!thread) return;
    const subtree = new Set(visibleThreadTreeIds([thread], allChildrenByThread));
    const next = threadGroups.map((group) => ({ ...group, threadIds: group.threadIds.filter((id) => !subtree.has(id)) }));
    if (destination) {
      const index = next.findIndex((group) => group.id === destination);
      if (index < 0) return;
      next[index] = { ...next[index], threadIds: [...new Set([...next[index].threadIds, threadId])] };
    }
    saveThreadGroups(next);
  }, [allChildrenByThread, saveThreadGroups, threadGroups, threads]);
  const addThreadGroup = useCallback(() => {
    if (threadGroups.length >= 12) { toast.error("You can have up to 12 custom groups."); return; }
    const name = window.prompt("Name this thread group");
    if (!name?.trim()) return;
    const trimmed = name.trim().slice(0, 40);
    if (threadGroups.some((group) => group.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      toast.error("A group with that name already exists.");
      return;
    }
    const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    saveThreadGroups([...threadGroups, { id, name: trimmed, threadIds: [] }]);
  }, [saveThreadGroups, threadGroups]);
  const renameThreadGroup = useCallback((group: SidebarThreadGroup) => {
    const name = window.prompt("Rename thread group", group.name);
    if (!name?.trim()) return;
    const trimmed = name.trim().slice(0, 40);
    if (threadGroups.some((candidate) => candidate.id !== group.id && candidate.name.localeCompare(trimmed, undefined, { sensitivity: "accent" }) === 0)) {
      toast.error("A group with that name already exists.");
      return;
    }
    saveThreadGroups(threadGroups.map((candidate) => candidate.id === group.id ? { ...candidate, name: trimmed } : candidate));
  }, [saveThreadGroups, threadGroups]);
  const removeThreadGroup = useCallback((group: SidebarThreadGroup) => {
    if ([...threadGroupIds.values()].includes(group.id)) return;
    saveThreadGroups(threadGroups.filter((candidate) => candidate.id !== group.id));
  }, [saveThreadGroups, threadGroupIds, threadGroups]);

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
  const navigateToThread = (threadId: string, split = false) => { actions.open(threadId, { split }); props.onNavigate(); };
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

  const viewToolbar = view === "queue" ? <><span>{filteredTasks.length} active task{filteredTasks.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedTaskIds.size > 1 && <span className="ws-selection-count" role="status">{selectedTaskIds.size} selected</span>}<button className="ws-icon-button" title="Refresh tasks" aria-label="Refresh tasks" onClick={() => void refreshTasks()}><Icon name="RefreshCw" aria-hidden /></button></span></> : view === "prs" ? <><span>{visibleAuthoredPullRequests.length} open pull request{visibleAuthoredPullRequests.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedPullRequestIds.size > 1 && <span className="ws-selection-count" role="status">{selectedPullRequestIds.size} selected</span>}<button className="ws-icon-button" title="Refresh pull requests" aria-label="Refresh pull requests" disabled={authoredPullRequestState === "loading"} onClick={() => setAuthoredPullRequestRefreshKey((value) => value + 1)}><Icon name="RefreshCw" aria-hidden /></button></span></> : <><span>{threadListMode === "native" ? "Threads" : `${filtered.length} thread${filtered.length === 1 ? "" : "s"}`}</span><span className="ws-work-toolbar-actions">{threadListMode === "enhanced" && <>{selectedThreadIds.size > 1 && <><span className="ws-selection-count" role="status">{selectedThreadIds.size} selected</span><button className="ws-selection-archive" onClick={() => void archiveSelected()}>Archive selected</button></>}{reorderDisabled && <span className="ws-reorder-disabled" role="status">Clear search to reorder</span>}</>}<span className="ws-thread-settings"><button className="ws-icon-button" title="Thread list settings" aria-label="Thread list settings" aria-expanded={threadSettingsOpen} onClick={() => setThreadSettingsOpen((open) => !open)}><Icon name="Wrench" aria-hidden /></button>{threadSettingsOpen && <span className="ws-thread-settings-menu" role="menu"><button role="menuitemradio" aria-checked={threadListMode === "enhanced"} onClick={() => setSavedThreadListMode("enhanced")}>Enhanced list</button><button role="menuitemradio" aria-checked={threadListMode === "native"} onClick={() => setSavedThreadListMode("native")}>BB native list</button><span className="ws-thread-group-settings"><b>Custom groups</b>{threadGroups.map((group) => <span key={group.id}><button title={`Rename ${group.name}`} onClick={() => renameThreadGroup(group)}>{group.name}</button><button className="ws-thread-group-remove" title={[...threadGroupIds.values()].includes(group.id) ? "Move its threads before removing" : `Remove ${group.name}`} disabled={[...threadGroupIds.values()].includes(group.id)} onClick={() => removeThreadGroup(group)}><Icon name="X" aria-hidden /></button></span>)}<button className="ws-thread-group-add" onClick={addThreadGroup}>Add group</button></span></span>}</span><button className="ws-icon-button" title="Refresh threads" aria-label="Refresh threads" onClick={() => void refreshThreadDetails()}><Icon name="RefreshCw" aria-hidden /></button>{props.activeProjectId && <Button className="ws-new-thread" variant="ghost" size="icon" title="New thread in project" aria-label="New thread in project" onClick={() => actions.openNewThread({ projectId: props.activeProjectId!, focusPrompt: true })}><Icon name="Plus" aria-hidden /></Button>}</span></>;

  return (
    <div className="ws-list">
      <nav className="ws-view-selector" aria-label="Sidebar views">
        {(["work", "queue", "prs"] as const).map((id) => <button key={id} className={view === id ? "ws-view-active" : ""} aria-pressed={view === id} onClick={() => setView(id)}>{sidebarViewLabel(id)}</button>)}
      </nav>
      <div className="ws-list-toolbar">{viewToolbar}</div>
      {view === "queue" && <div className="ws-view-content">
        {taskState === "loading" && <div className="ws-empty">Loading tasks…</div>}
        {taskState === "error" && <div className="ws-callout">{taskError ?? "Could not load tasks."}<button onClick={() => void refreshTasks()}>Try again</button></div>}
        {taskState === "ready" && taskQueue.map((node) => <SidebarTaskRow key={node.task.id} node={node} siblings={taskQueue} showProject={(taskKeys.get(node.task.key) ?? 0) > 1} reorderDisabled={reorderDisabled} dragTaskId={dragTaskId} dropTarget={taskDropTarget} onDragTaskChange={setDragTaskId} onDragTargetChange={(taskId, placement) => setTaskDropTarget(taskId && placement ? { taskId, placement } : null)} onDropTask={(sourceId, targetId, placement) => void persistTaskReorder(sourceId, targetId, placement)} onMoveTask={moveTask} onOpenThread={navigateToThread} onUpdateStatus={updateTaskStatus} updatingTaskId={updatingTaskId} selectedTaskIds={selectedTaskIds} onSelect={selectTask} />)}
        {taskState === "ready" && filteredTasks.length === 0 && <div className="ws-empty">{props.searchQuery ? `No tasks match “${props.searchQuery}”.` : "No active tasks."}</div>}
      </div>}
      {view === "prs" && <div className="ws-view-content">
        {authoredPullRequestState === "loading" && <div className="ws-empty">Loading your open pull requests…</div>}
        {authoredPullRequestState === "error" && <div className="ws-callout"><strong>Could not load your open pull requests</strong><span>{authoredPullRequestError}</span></div>}
        {authoredPullRequestState === "ready" && <>{authoredPullRequestGroups.map((group) => <section className="ws-pr-repository-group" key={group.repository}><h3>{group.repository}</h3>{group.stacks.map((stack) => <AuthoredPrStack key={stack.id} stack={stack} selectedIds={selectedPullRequestIds} changingDraftUrl={changingDraftUrl} onSelect={selectPullRequest} onToggleDraft={toggleAuthoredPullRequestDraft} />)}{group.ordinary.map((pullRequest) => <section className="ws-pr-stack ws-pr-stack-singleton" key={pullRequest.url}><AuthoredPrRow pullRequest={pullRequest} selected={selectedPullRequestIds.has(pullRequest.url)} changingDraft={changingDraftUrl === pullRequest.url} onSelect={selectPullRequest} onToggleDraft={toggleAuthoredPullRequestDraft} /></section>)}</section>)}{visibleAuthoredPullRequests.length === 0 && <div className="ws-empty"><strong>No open pull requests</strong><span>{props.searchQuery ? `No pull requests match “${props.searchQuery}”.` : "Open pull requests you author on GitHub appear here."}</span></div>}</>}
      </div>}
      {view === "work" && <>
      {threadListMode === "native" ? <section className="ws-native-thread-list" aria-label="BB native threads"><Original /></section> : <><section className="ws-thread-statuses" aria-label="Thread status groups">
      <details className="ws-later ws-active-threads" data-ws-thread-drop-zone="active" data-drop-target={threadDropTarget?.threadId === "active" || undefined} open={activeThreadsOpen} onToggle={(event) => setActiveThreadsOpen(event.currentTarget.open)} onDragOver={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || (!threadGroupIds.has(sourceId) && !archivedThreadIds.has(sourceId))) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setThreadDropTarget({ threadId: "active", placement: "after" }); }} onDrop={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || (!threadGroupIds.has(sourceId) && !archivedThreadIds.has(sourceId))) return; event.preventDefault(); if (archivedThreadIds.has(sourceId)) unarchiveThread(sourceId, null); else moveThreadToGroup(sourceId, null); setDragThreadId(null); setThreadDropTarget(null); }}>
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
            groupIds={threadGroupIds}
            groups={threadGroups}
            projectsById={projectsById}
            onNavigate={props.onNavigate}
            onSelect={selectThread}
            onMoveToGroup={moveThreadToGroup}
            orderedSiblings={orderedRoots}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={setDragThreadId}
            dropTarget={threadDropTarget}
            onDropTargetChange={setThreadDropTarget}
            onDropThread={reorder}
            onMoveThread={move}
            subtextRefreshKey={subtextRefreshKey}
          />
        ))}
      </section>
      </details>
      {threadGroups.map((group) => { const tree = groupedThreadTrees.get(group.id); const roots = tree?.roots ?? []; return <details key={group.id} className="ws-later" data-ws-thread-drop-zone={group.id} data-drop-target={threadDropTarget?.threadId === group.id || undefined} open onDragOver={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || threadGroupIds.get(sourceId) === group.id) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setThreadDropTarget({ threadId: group.id, placement: "after" }); }} onDrop={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || threadGroupIds.get(sourceId) === group.id) return; event.preventDefault(); if (archivedThreadIds.has(sourceId)) unarchiveThread(sourceId, group.id); else moveThreadToGroup(sourceId, group.id); setDragThreadId(null); setThreadDropTarget(null); }}><summary>{group.name} <span>{roots.length}</span></summary>{roots.length > 0 ? <section className="ws-hierarchy" aria-label={`${group.name} threads`}>{roots.map((thread) => <WorkThreadTree key={thread.id} thread={thread} childrenByThread={tree?.children ?? new Map()} taskLinks={taskLinks} activeThreadId={props.activeThreadId} selectedThreadIds={selectedThreadIds} groupIds={threadGroupIds} groups={threadGroups} projectsById={projectsById} onNavigate={props.onNavigate} onSelect={selectThread} onMoveToGroup={moveThreadToGroup} orderedSiblings={roots} reorderDisabled={reorderDisabled} dragThreadId={dragThreadId} onDragThreadChange={setDragThreadId} dropTarget={threadDropTarget} onDropTargetChange={setThreadDropTarget} onDropThread={reorder} onMoveThread={move} subtextRefreshKey={subtextRefreshKey} />)}</section> : <div className="ws-later-empty">Right-click a thread to move it here.</div>}</details>; })}
      <details className="ws-later ws-archived" data-ws-thread-drop-zone="archive" data-drop-target={threadDropTarget?.threadId === "archive" || undefined} open={archivedOpen} onToggle={(event) => setArchivedOpen(event.currentTarget.open)} onDragOver={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || archivedThreadIds.has(sourceId)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setThreadDropTarget({ threadId: "archive", placement: "after" }); }} onDrop={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || archivedThreadIds.has(sourceId)) return; event.preventDefault(); if (threadGroupIds.has(sourceId)) moveThreadToGroup(sourceId, null); actions.archive(sourceId); window.setTimeout(() => void refreshArchivedThreads(true), 250); setDragThreadId(null); setThreadDropTarget(null); }}><summary>Archive <span>{archivedThreadState === "ready" ? archivedThreads.length : ""}</span></summary>{archivedThreadState === "idle" || archivedThreadState === "loading" ? <div className="ws-later-empty">Loading archive threads…</div> : archivedThreadState === "error" ? <div className="ws-callout">{archivedThreadError ?? "Could not load archive threads."}<button onClick={() => void refreshArchivedThreads(true)}>Try again</button></div> : archivedThreads.length > 0 ? <section className="ws-hierarchy" aria-label="Archive threads">{archivedThreads.map((thread) => <ArchivedThreadRow key={thread.id} thread={thread} project={projectsById.get(thread.projectId)} groups={threadGroups} onUnarchive={unarchiveThread} onNavigate={props.onNavigate} onDragThreadChange={setDragThreadId} onDropTargetChange={() => setThreadDropTarget(null)} />)}</section> : <div className="ws-later-empty">No archive threads.</div>}</details>
      </section>
      {filtered.length === 0 && <div className="ws-empty">{props.searchQuery ? `No threads match “${props.searchQuery}”.` : "No active threads."}</div>}
      </>}
      </>}
    </div>
  );
}

type WorkTab = "work" | "changes" | "agents";

const WORK_TABS: readonly { id: WorkTab; label: string; description: string }[] = [
  { id: "work", label: "Work", description: "Outcome, execution tasks, goal, and plan" },
  { id: "changes", label: "Changes", description: "Pull request, stack, branch, and working-tree state" },
  { id: "agents", label: "Agents", description: "Delegated child threads" },
];

type WorkPanelChild = {
  id: string;
  title: string;
  depth: number;
  status: string;
  runtimeStatus: string;
  task: { key: string; status: string; liveStatus: string | null } | null;
};

type WorkPanelBinding = { ownerThreadId: string | null; dispatchState: string; recoveryMessage: string | null };

/** An agent row keeps ordinary open and deliberate split navigation separate. */
function WorkAgentRow({ child, bindings }: { child: WorkPanelChild; bindings: readonly WorkPanelBinding[] }) {
  const actions = experimental_useSidebarThreadActions();
  const { isAvailable: splitAvailable } = experimental_useSidebarThreadSplit(child.id);
  const state = agentProjectionState(child.status, child.task?.status ?? null);
  const runtime = runtimeStatusPresentation(child);
  const owned = bindings.find((binding) => binding.ownerThreadId === child.id);
  return <article className={`ws-agent-card ws-agent-${state}`} style={{ marginLeft: `${Math.min(child.depth - 1, 4) * 0.65}rem` }}>
    <Icon name="Bot" className={`ws-agent-state ws-agent-state-${runtime.tone}`} aria-label={runtime.label} />
    <button type="button" className="ws-agent-target" onClick={() => actions.open(child.id)} aria-label={`Open ${child.title}`}>
      <strong>{child.title}</strong>
      <small>{runtime.label}{child.task ? ` · ${child.task.key}` : ""}{owned ? ` · ${readableStatus(owned.dispatchState)}` : ""}</small>
      {owned?.recoveryMessage && <small>{owned.recoveryMessage}</small>}
    </button>
    {splitAvailable && <button type="button" className="ws-agent-split" onClick={() => actions.open(child.id, { split: true })} aria-label={`Open ${child.title} in split`} title="Open in split"><Icon name="Columns2" aria-hidden /></button>}
  </article>;
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
  const activityRefreshInFlight = useRef(false);
  const [activity, setActivity] = useState<{ latest: { text: string; kind: "assistant" | "user" | "command" | "activity" } | null; lastUser: { text: string; kind: "user" } | null; current: { text: string; kind: "assistant" | "user" | "command" | "activity" } | null } | null>(null);
  const [expandedActivity, setExpandedActivity] = useState<Set<string>>(() => new Set());
  const [taskTitle, setTaskTitle] = useState("");
  const [createTaskState, setCreateTaskState] = useState<"idle" | "working" | "error">("idle");
  const [createTaskError, setCreateTaskError] = useState<string | null>(null);
  const [linearBusy, setLinearBusy] = useState(false);
  const [pendingChangesExpanded, setPendingChangesExpanded] = useState(false);
  const [currentPrExpanded, setCurrentPrExpanded] = useState(false);
  const [expandedStackBranches, setExpandedStackBranches] = useState<Set<string>>(() => new Set());
  const [checkingOutBranch, setCheckingOutBranch] = useState<string | null>(null);
  const [workingTreeDiff, setWorkingTreeDiff] = useState<{ path: string; patch: string | null; loading: boolean; message: string | null } | null>(null);

  const refresh = useCallback(async () => {
    const request = ++requestId.current;
    setLoading(true); setError(null);
    try {
      const next = await rpc.call("getWorkContext", { threadId });
      if (request !== requestId.current) return;
      setContext(next);
      setActivity(next.activity);
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
  useEffect(() => {
    if (context?.currentThread.status !== "active" && context?.currentThread.status !== "starting") return;
    const refreshActivity = async () => {
      if (activityRefreshInFlight.current) return;
      activityRefreshInFlight.current = true;
      try {
        const nextActivity = await rpc.call("getLatestActivity", { threadId });
        setActivity(nextActivity);
        setContext((current) => current ? { ...current, currentThread: { ...current.currentThread, ...nextActivity.currentThread } } : current);
      } catch { /* Retain the last good activity during a transient poll failure. */ } finally { activityRefreshInFlight.current = false; }
    };
    void refreshActivity();
    const interval = window.setInterval(() => { void refreshActivity(); }, 2_000);
    return () => window.clearInterval(interval);
  }, [context?.currentThread.status, rpc, threadId]);

  const openWorkingTreeDiff = async (path: string) => {
    setWorkingTreeDiff({ path, patch: null, loading: true, message: null });
    try {
      const result = await rpc.call("getWorkingTreeFileDiff", { threadId, path });
      setWorkingTreeDiff({ path, patch: result.patch, loading: false, message: result.message });
    } catch (error) {
      setWorkingTreeDiff({ path, patch: null, loading: false, message: error instanceof Error ? error.message : "Could not load the file diff." });
    }
  };

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
  const activityItems = context && activity ? [
    { label: "Agent", entry: activity.latest },
    { label: "User", entry: activity.lastUser },
  ].filter((item, index, items) => item.entry && items.findIndex((candidate) => candidate.entry?.text === item.entry?.text) === index) : [];
  const linkLinear = async (key: string) => { setLinearBusy(true); try { const item = await rpc.call("linkLinearIssue", { threadId, key }); toast.success(`${item.key} linked`); await refresh(); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not link Linear issue"); } finally { setLinearBusy(false); } };
  const searchLinear = useCallback(async (query: string) => (await rpc.call("searchLinearIssues", { threadId, query })).items, [rpc, threadId]);
  const unlinkLinear = async () => { setLinearBusy(true); try { await rpc.call("unlinkLinearIssue", { threadId }); await refresh(); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not unlink Linear issue"); } finally { setLinearBusy(false); } };
  const moveLinear = async (statusId: string) => { if (!statusId) return; setLinearBusy(true); try { const item = await rpc.call("updateLinearIssueStatus", { threadId, statusId }); toast.success(`${item.key} moved to ${item.status}`); await refresh(); } catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update Linear issue"); } finally { setLinearBusy(false); } };
  const advanceOutcome = async () => {
    if (!outcomeTask || updatingTask === outcomeTask.id) return;
    const nextStatus = ({ backlog: "todo", todo: "in_progress", in_progress: "in_review", in_review: "done", done: undefined, canceled: undefined } as const)[outcomeTask.status];
    if (!nextStatus) return;
    setUpdatingTask(outcomeTask.id);
    try { await rpc.call("updateWorkTask", { taskId: outcomeTask.id, status: nextStatus }); await refresh(); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not update task"); }
    finally { setUpdatingTask(null); }
  };
  const toggleStackBranch = (branch: string) => setExpandedStackBranches((current) => { const next = new Set(current); next.has(branch) ? next.delete(branch) : next.add(branch); return next; });
  const checkoutStackBranch = async (branch: string) => {
    if (checkingOutBranch) return;
    setCheckingOutBranch(branch);
    try { const result = await rpc.call("checkoutStackBranch", { threadId, branch }); result.ok ? toast.success(result.message) : toast.error(result.message); await refresh(); }
    catch (caught) { toast.error(caught instanceof Error ? caught.message : "Could not check out branch"); }
    finally { setCheckingOutBranch(null); }
  };

  return (
    <div className="ws-panel">
      <header className="ws-panel-header">
        <div className="ws-panel-heading">
          <Icon name="ListTodo" className="ws-panel-icon" aria-hidden />
          <div><strong>Work</strong><span>{context?.currentThread.title ?? "Active thread"}</span></div>
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
        {!loading && context && <article className="ws-card ws-status-card"><div className="ws-card-heading"><strong>Status</strong></div><div className="ws-status-summary"><h3>{runtimeStatusPresentation(context.currentThread).label}</h3><p className="ws-working-state"><span title={`${context.children.filter((child) => !child.isArchived).length} child agent${context.children.filter((child) => !child.isArchived).length === 1 ? "" : "s"}`}><Icon name="Bot" aria-hidden />{context.children.filter((child) => !child.isArchived).length}</span><span title={`${context.children.filter((child) => !child.isArchived && child.status === "active").length} active child agent${context.children.filter((child) => !child.isArchived && child.status === "active").length === 1 ? "" : "s"}`}><Icon name="Wrench" aria-hidden />{context.children.filter((child) => !child.isArchived && child.status === "active").length}</span></p></div>{activityItems.length > 0 ? <div className="ws-activity-list">{activityItems.map(({ label, entry }) => entry && <button type="button" className={`ws-activity-item ${entry.kind === "command" ? "ws-activity-item-command" : ""} ${expandedActivity.has(label) ? "ws-activity-item-expanded" : ""}`} key={label} aria-expanded={expandedActivity.has(label)} onClick={() => setExpandedActivity((current) => { const next = new Set(current); next.has(label) ? next.delete(label) : next.add(label); return next; })}><span className="ws-activity-label">{label}</span>{entry.kind === "command" ? <code className="ws-activity-command">{entry.text}</code> : <span className="ws-activity-copy">{entry.text}</span>}</button>)}</div> : <p className="ws-card-note">No activity has been recorded yet.</p>}<span className={`ws-focus-state ws-working-blinker ws-focus-state-${runtimeStatusPresentation(context.currentThread).tone}`} aria-label={`${runtimeStatusPresentation(context.currentThread).label} status`} /></article>}
        {!loading && context && tab === "work" && (
          <div className="ws-section-stack">
            <header><div><h2>Work</h2></div><span className="ws-work-header-badges">{outcomeTask && <span className="ws-work-header-badge" title={`${outcomeTask.key} · ${outcomeTask.title}`}>{outcomeTask.key}</span>}{context.tracker.item && <a className="ws-work-header-badge ws-linear-header-badge" href={context.tracker.item.url} target="_blank" rel="noreferrer" title={`${context.tracker.item.key} · ${context.tracker.item.title}`}>{context.tracker.item.key}</a>}</span></header>
            <LinearCard context={context} linking={linearBusy} onLink={(key) => void linkLinear(key)} onUnlink={() => void unlinkLinear()} onMove={(statusId) => void moveLinear(statusId)} onSearch={searchLinear} />
            {!context.tasksAvailable && <article className="ws-card ws-empty-state-card"><div className="ws-card-heading"><strong>Tasks</strong></div><p className="ws-card-note">Tasks are unavailable right now.</p><button type="button" className="ws-compact-action" onClick={() => void refresh()}>Check again</button></article>}
            {outcomeTask && (
              <article key={outcomeTask.id} className="ws-card ws-outcome-card">
                <div className="ws-card-heading"><strong>Outcome</strong><span className="ws-task-card-icons">{outcomeTask.priority !== "none" && <span className="ws-pr-tooltip" data-tooltip={`${readableStatus(outcomeTask.priority)} priority`}><Icon name="AlertCircle" className={`ws-priority-icon ws-priority-${outcomeTask.priority}`} aria-label={`${readableStatus(outcomeTask.priority)} priority`} /></span>}</span></div>
                <div className="ws-outcome-body"><div><p className="ws-card-note ws-outcome-key">{outcomeTask.key}</p><h3>{outcomeTask.title}</h3></div>{outcomeTask.status !== "done" && outcomeTask.status !== "canceled" && context.tasksAvailable && <button type="button" className={`ws-work-status-button ws-work-status-${outcomeTask.status} ws-pr-tooltip`} data-tooltip={`Move ${readableStatus(outcomeTask.status)} to the next state`} disabled={updatingTask === outcomeTask.id} onClick={() => void advanceOutcome()} aria-label={`Current task status: ${readableStatus(outcomeTask.status)}. Move to the next state.`}><Icon name={updatingTask === outcomeTask.id ? "LoaderCircle" : outcomeTask.status === "in_review" ? "Check" : "ArrowRight"} aria-hidden /></button>}</div>
                {outcomeTask.dueDate && <div className="ws-card-meta"><span>Due {outcomeTask.dueDate}</span></div>}
              </article>
            )}
            {!outcomeTask && (
              <article className="ws-card ws-outcome-empty">
                <div className="ws-card-heading"><strong>Outcome</strong></div>
                <p className="ws-card-note">No current outcome.</p>
                <div className="ws-outcome-form">
                  <Input disabled={!context.tasksAvailable || createTaskState === "working"} aria-label="Outcome-oriented task title" placeholder="Outcome-oriented task title" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void createTask(); }} />
                  <button type="button" className="ws-outcome-create-button" title="Create and attach outcome task" aria-label="Create and attach outcome task" disabled={!context.tasksAvailable || createTaskState === "working" || !taskTitle.trim()} onClick={() => void createTask()}>{createTaskState === "working" ? "…" : "Create"}</button>
                </div>
                {createTaskError && <div className="ws-inline-error" role="alert">{createTaskError}</div>}
              </article>
            )}
            <article className="ws-card ws-execution-card"><div className="ws-card-heading"><strong>Tasks</strong><span className="ws-section-count">{executionTasks.length}</span></div>{executionTasks.length > 0 ? <div className="ws-subtask-list">{executionTasks.map((task) => { const binding = bindings.find((candidate) => candidate.executionTaskId === task.id); return <div key={task.id} className="ws-subtask ws-subtask-card"><span className={`ws-status-dot ws-status-dot-${task.status}`}>{task.status === "done" ? "✓" : "•"}</span><span><strong>{task.title}</strong><small>{task.key} · {readableStatus(task.status)}</small>{binding && <small>{binding.mode ? `${readableStatus(binding.mode)} owner` : "Unowned"} · {readableStatus(binding.dispatchState)}{binding.recoveryMessage ? ` · ${binding.recoveryMessage}` : ""}</small>}</span></div>; })}</div> : <p className="ws-card-note">No execution tasks are attached to this outcome yet.</p>}</article>
            <section className="ws-agent-context" aria-label="Agent context">
            <article className="ws-card ws-goal"><div className="ws-card-heading"><strong>Goal</strong>{context.goal && <span>{readableStatus(context.goal.status)}</span>}</div>{context.goal ? <><h3>{context.goal.objective}</h3>{goalProgressPercent(context.goal) !== null && <div className="ws-progress" role="progressbar" aria-label="Goal token usage" aria-valuemin={0} aria-valuemax={100} aria-valuenow={goalProgressPercent(context.goal)!}><span style={{ width: `${goalProgressPercent(context.goal)}%` }} /></div>}</> : <p className="ws-card-note">No goal supplied by this harness.</p>}</article>
            <article className="ws-card ws-plan-card"><div className="ws-card-heading"><strong>Plan</strong>{context.todos.length > 0 && <span className="ws-section-count">{context.todos.filter((item) => item.status === "completed").length} / {context.todos.length}</span>}</div><div className="ws-plan">
              {context.todos.map((item) => <div key={item.id} className={`ws-plan-item ws-plan-${item.status}`}><span aria-hidden="true">{item.status === "completed" ? "✓" : item.status === "in_progress" ? "●" : "○"}</span><span>{item.text}</span><span className="sr-only">{readableStatus(item.status)}</span></div>)}
              {context.todos.length === 0 && <p className="ws-card-note">No plan supplied by this harness.</p>}
            </div></article>
            </section>
          </div>
        )}
        {!loading && context && tab === "changes" && (
          <div className="ws-section-stack">
            <header><div><h2>Changes</h2></div><span className="ws-section-count">{context.currentPullRequest ? `#${context.currentPullRequest.number}` : "No PR"}</span></header>
            <article className="ws-card ws-repository-card"><div className="ws-card-heading"><strong>{context.repository.branch ?? "Repository"}</strong><span className={`ws-pill ${context.repository.hasUncommittedChanges ? "ws-pr-changes_requested" : ""}`}>{context.repository.hasUncommittedChanges ? "Changed" : context.repository.outcome === "available" ? "Clean" : "Unavailable"}</span></div>{context.repository.outcome === "available" ? <><div className="ws-card-meta"><span>{context.repository.ahead}↑ {context.repository.behind}↓</span><span>{context.repository.base ?? "—"}</span>{context.repository.changedFileCount > 0 && <button type="button" className="ws-repository-changes-toggle" aria-expanded={pendingChangesExpanded} onClick={() => setPendingChangesExpanded((expanded) => !expanded)} aria-label={`${pendingChangesExpanded ? "Hide" : "Show"} ${context.repository.changedFileCount} working-tree file${context.repository.changedFileCount === 1 ? "" : "s"}`}><b>{context.repository.changedFileCount}</b> file{context.repository.changedFileCount === 1 ? "" : "s"} <i>+{context.repository.changedInsertions}</i> <em>−{context.repository.changedDeletions}</em> {pendingChangesExpanded ? "⌄" : "›"}</button>}</div>{pendingChangesExpanded && context.repository.changedFileCount > 0 && <div className="ws-current-pr-details ws-working-tree-files">{context.repository.changedFiles.map((file) => <button type="button" className="ws-working-tree-file" key={file.path} onClick={() => void openWorkingTreeDiff(file.path)} aria-label={`Open uncommitted diff for ${file.path}`}><b className={`ws-file-${file.status}`}>{file.status[0]?.toUpperCase()}</b><em>{file.path}</em><small>{file.insertions !== null ? `+${file.insertions}` : ""} {file.deletions !== null ? `−${file.deletions}` : ""}</small></button>)}{context.repository.changedFileCount > context.repository.changedFiles.length && <small>Only the first {context.repository.changedFiles.length} files are shown.</small>}</div>}</> : <p className="ws-card-note">{context.repository.message ?? "Repository status is unavailable."}</p>}</article>
            {workingTreeDiff && <article className="ws-card ws-working-tree-diff"><div className="ws-card-heading"><strong>{workingTreeDiff.path}</strong><button type="button" className="ws-text-button" onClick={() => setWorkingTreeDiff(null)}>Close</button></div>{workingTreeDiff.loading ? <p className="ws-card-note">Loading diff…</p> : workingTreeDiff.patch ? <ChangesWorkingTreeDiff patch={workingTreeDiff.patch} /> : <p className="ws-card-note">{workingTreeDiff.message ?? "No diff is available for this file."}</p>}</article>}
            {context.githubStack?.stack ? <ol className="ws-stack-rail" aria-label={`GitHub Stack based on ${context.githubStack.stack.trunk}`}>
              {context.githubStack.stack.branches.map((branch) => { const stackPullRequest = context.stack?.pullRequests.find((pullRequest) => pullRequest.number === branch.pr?.number || pullRequest.head === branch.name); const legacySignals = stackPullRequest as Partial<StackBranchSignals> | undefined; const current = branch.pr?.number === context.currentPullRequest?.number ? context.currentPullRequest : null; const checks: "failed" | "passing" | "pending" | "none" = current?.checks.state === "failing" ? "failed" : current?.checks.state === "passing" ? "passing" : current?.checks.state === "pending" ? "pending" : "none"; const signals = current ? { ...stackPullRequest, state: current.state, draft: current.state === "draft", checks, review: current.review.state } : branch.pr ? { ...stackPullRequest, state: stackPullRequest?.state ?? branch.pr.state, draft: stackPullRequest?.draft ?? branch.pr.isDraft, checks: branch.checks ?? legacySignals?.checks ?? "unknown", review: branch.review ?? legacySignals?.review ?? "none" } : stackPullRequest; return <ChangesStackBranchRow key={branch.name} branch={branch} signals={signals} expanded={expandedStackBranches.has(branch.name)} checkingOut={checkingOutBranch === branch.name} onToggle={() => toggleStackBranch(branch.name)} onCheckout={() => void checkoutStackBranch(branch.name)} />; })}
            </ol> : context.currentPullRequest ? <ChangesPullRequestCard pullRequest={context.currentPullRequest} expanded={currentPrExpanded} onToggle={() => setCurrentPrExpanded((expanded) => !expanded)} /> : <div className="ws-empty">No pull request is linked to this thread.</div>}
          </div>
        )}
        {!loading && context && tab === "agents" && (
          <div className="ws-section-stack">
            <header><div><h2>Agents</h2></div><span className="ws-section-count">{context.children.filter((child) => !child.isArchived).length}</span></header>
            {context.children.filter((child) => !child.isArchived).map((child) => <WorkAgentRow key={child.id} child={child} bindings={bindings} />)}
            {context.children.filter((child) => !child.isArchived).length === 0 && <div className="ws-empty">No active delegated child threads are attached to this thread.</div>}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkContextHeaderAction({ isCompactViewport }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  return <button type="button" className="ws-header-action" aria-label="Open Work" title="Open Work" onClick={() => { navigate.openThreadPanel({ actionId: "work-context" }); }}>{isCompactViewport ? "▣" : "Work"}</button>;
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
    id: "work-context", title: "Work", icon: "ListTodo", component: WorkPanel, layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "work-context-header", title: "Work", component: WorkContextHeaderAction,
  });
  app.composer.customize({
    id: "task-first", scopes: ["thread"], actions: [{ id: "track-work", component: TrackWorkAction }],
  });
});
