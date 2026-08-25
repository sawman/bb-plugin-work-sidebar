import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
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
  orderTasks,
  taskMatchesSearch,
  type SidebarTask,
  agentProjectionState,
  goalProgressPercent,
  orderStackLayers,
  type CurrentPullRequestView,
} from "./work-model";
import { Icon } from "@/components/ui/icon";
import "./app.css";
import "./views.css";

const SIDEBAR_ORDER_CHANNEL = "sidebar-order:changed";

function indicatorGlyph(value: string): string {
  switch (normalizeIndicator(value)) {
    case "runtime": case "workflow": case "background-agent": case "background-command": return "●";
    case "unread-error": return "!";
    case "unread-success": return "✓";
    case "waiting-for-input": return "?";
    case "goal": return "◆";
    case "plan-mode": return "◫";
    default: return "";
  }
}

function ThreadRow({
  thread,
  active,
  taskLinks,
  children,
  childrenExpanded,
  onToggleChildren,
  project,
  onNavigate,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  dragThreadId,
  onDragThreadChange,
  canDropThread,
  onDropThread,
  onMoveThread,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  taskLinks?: readonly ThreadTaskLink[];
  children: number;
  childrenExpanded: boolean;
  onToggleChildren(): void;
  project?: { name: string; isPersonal: boolean };
  onNavigate(): void;
  reorderDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  canDropThread(sourceId: string): boolean;
  onDropThread(sourceId: string, targetId: string, placement: "before" | "after"): void;
  onMoveThread(threadId: string, direction: -1 | 1): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(thread.id);
  const { pullRequest, isLoading: pullRequestLoading } = experimental_useSidebarThreadPullRequest(thread.id);
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(threadTitle(thread));
  const projectLabel = project?.isPersonal ? "Personal" : project?.name ?? "Project";
  const title = threadTitle(thread);

  const open = (split = false) => {
    actions.open(thread.id, { split });
    onNavigate();
  };
  const commitRename = async () => {
    const next = draftTitle.trim();
    if (next && next !== threadTitle(thread)) await actions.rename(thread.id, next);
    setRenaming(false);
  };

  return (
    <div
      className={`ws-thread ${active ? "ws-thread-active" : ""} ${dragThreadId === thread.id ? "ws-thread-dragging" : ""}`}
      data-depth={thread.parentThreadId ? "child" : "root"}
      onDragOver={(event) => {
        if (reorderDisabled || !dragThreadId || dragThreadId === thread.id || !canDropThread(dragThreadId)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
      }}
      onDrop={(event) => {
        if (reorderDisabled || !dragThreadId || dragThreadId === thread.id || !canDropThread(dragThreadId)) return;
        event.preventDefault();
        const bounds = event.currentTarget.getBoundingClientRect();
        const placement = event.clientY > bounds.top + bounds.height / 2 ? "after" : "before";
        onDropThread(dragThreadId, thread.id, placement);
        onDragThreadChange(null);
      }}
    >
      {children > 0 ? <button
        type="button"
        className="ws-thread-disclosure"
        aria-label={`${childrenExpanded ? "Collapse" : "Expand"} ${children} child agent${children === 1 ? "" : "s"}`}
        aria-expanded={childrenExpanded}
        onClick={onToggleChildren}
      >{childrenExpanded ? "⌄" : "›"}</button> : <span className="ws-thread-disclosure-placeholder" aria-hidden="true" />}
      <button
        type="button"
        className="ws-thread-drag-handle"
        draggable={!reorderDisabled}
        disabled={reorderDisabled}
        aria-label={`Drag to reorder ${threadTitle(thread)}`}
        title={reorderDisabled ? "Clear search to reorder" : "Drag to reorder among siblings"}
        onDragStart={(event) => {
          event.dataTransfer.effectAllowed = "move";
          event.dataTransfer.setData("text/plain", thread.id);
          onDragThreadChange(thread.id);
        }}
        onDragEnd={() => onDragThreadChange(null)}
      >⠿</button>
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
              data-sidebar-thread-id={thread.id}
              className={`ws-thread-anchor ${children > 0 ? "ws-thread-has-children" : ""}`}
              onClick={(event) => { event.preventDefault(); open(false); }}
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
                  {taskLinks?.map((taskLink) => <span className="ws-task-key" key={`${taskLink.task.id}:${taskLink.role}`}>{taskLink.task.key}</span>)}
                  <span>{thread.environment?.branchName || (project?.isPersonal ? "Personal" : projectLabel)}</span>
                  {pullRequest && <span className={`ws-pr-meta ws-pr-${pullRequest.attention}`}>PR #{pullRequest.number} · {pullRequest.state}</span>}
                  {pullRequestLoading && <span className="ws-pr-meta" aria-label="Pull request loading">PR loading…</span>}
                  {children > 0 && <span>{children} agent{children === 1 ? "" : "s"}</span>}
                </span>
              </span>
              <span className="ws-thread-trailing">
                <span className={`ws-status ws-status-${normalizeIndicator(String(thread.indicator))}`} aria-label={thread.indicatorLabel ?? undefined}>
                  {indicatorGlyph(String(thread.indicator))}
                </span>
                {thread.isPinned && <span className="ws-state" title="Pinned">◆</span>}
                {thread.isUnread && <span className="ws-unread-dot" title="Unread" />}
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
            <ContextMenuItem onSelect={() => actions.archive(thread.id)}>Archive</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.requestDelete(thread.id)}>
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
  projectsById,
  onNavigate,
  orderedSiblings,
  reorderDisabled,
  dragThreadId,
  onDragThreadChange,
  onDropThread,
  onMoveThread,
  depth = 0,
}: {
  thread: PluginSidebarThread;
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  activeThreadId: string | null;
  projectsById: ReadonlyMap<string, { name: string; isPersonal: boolean }>;
  onNavigate(): void;
  orderedSiblings: readonly PluginSidebarThread[];
  reorderDisabled: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  onDropThread(sourceId: string, targetId: string, placement: "before" | "after"): void;
  onMoveThread(threadId: string, direction: -1 | 1): void;
  depth?: number;
}) {
  const children = childrenByThread.get(thread.id) ?? [];
  const [childrenExpanded, setChildrenExpanded] = useState(true);
  const siblingIndex = orderedSiblings.findIndex((sibling) => sibling.id === thread.id);
  return (
    <>
      <ThreadRow
        thread={thread}
        active={thread.id === activeThreadId}
        taskLinks={taskLinks[thread.id]}
        children={children.length}
        childrenExpanded={childrenExpanded}
        onToggleChildren={() => setChildrenExpanded((expanded) => !expanded)}
        project={projectsById.get(thread.projectId)}
        onNavigate={onNavigate}
        reorderDisabled={reorderDisabled}
        canMoveUp={siblingIndex > 0}
        canMoveDown={siblingIndex >= 0 && siblingIndex < orderedSiblings.length - 1}
        dragThreadId={dragThreadId}
        onDragThreadChange={onDragThreadChange}
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
            projectsById={projectsById}
            onNavigate={onNavigate}
            orderedSiblings={children}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={onDragThreadChange}
            onDropThread={onDropThread}
            onMoveThread={onMoveThread}
            depth={depth + 1}
          />
        </div>
      ))}
    </>
  );
}

function PullRequestRow({
  thread,
  active,
  projectName,
  query,
  visible,
  onNavigate,
  onStateChange,
}: {
  thread: PluginSidebarThread;
  active: boolean;
  projectName: string;
  query: string;
  visible: boolean;
  onNavigate(): void;
  onStateChange(threadId: string, state: { isLoading: boolean; pullRequest: ReturnType<typeof experimental_useSidebarThreadPullRequest>["pullRequest"] }): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(thread.id);
  const { pullRequest, isLoading } = experimental_useSidebarThreadPullRequest(thread.id);
  const pullRequestSignature = pullRequest
    ? `${pullRequest.number}:${pullRequest.title}:${pullRequest.url}:${pullRequest.state}:${pullRequest.attention}`
    : "none";
  useEffect(() => {
    onStateChange(thread.id, { isLoading, pullRequest });
  }, [isLoading, onStateChange, pullRequestSignature, thread.id]);
  if (!visible || (!pullRequest && !isLoading)) return null;
  if (pullRequest && !matchesPullRequestSearch(thread, projectName, pullRequest, query)) return null;
  const open = (split = false) => { actions.open(thread.id, { split }); onNavigate(); };
  return (
    <div className={`ws-pr-row ${active ? "ws-thread-active" : ""}`}>
      <a
        href="#" {...splitProps} data-sidebar-thread-shortcut-target="" data-sidebar-thread-id={thread.id}
        className="ws-thread-anchor" onClick={(event) => { event.preventDefault(); open(false); }}
      >
        <span className={`ws-pr-state ws-pr-${pullRequest?.attention ?? "none"}`} aria-label={pullRequest?.attention ?? "Loading pull request"}>
          {pullRequest?.state === "merged" ? "✓" : pullRequest?.state === "closed" ? "×" : "●"}
        </span>
        <span className="ws-thread-main">
          <span className="ws-thread-title">{pullRequest ? `#${pullRequest.number} ${pullRequest.title}` : "Loading pull request…"}</span>
          <span className="ws-thread-meta"><span>{thread.environment?.branchName || "No branch"}</span><span>· {threadTitle(thread)}</span></span>
        </span>
        {pullRequest && <span className="ws-pr-state-label">{pullRequest.state}</span>}
      </a>
      {isAvailable && <button type="button" className="ws-pr-split" title="Open in split" onClick={() => open(true)}>Split</button>}
    </div>
  );
}

function TaskRow({ task, onOpenThread, onUpdate }: { task: SidebarTask; onOpenThread(threadId: string): void; onUpdate(taskId: string, status: "in_review"): Promise<void> }) {
  const linkedThreadId = task.linkedThreadIds[0];
  const [updating, setUpdating] = useState(false);
  const update = async () => {
    setUpdating(true);
    try { await onUpdate(task.id, "in_review"); }
    finally { setUpdating(false); }
  };
  return (
    <article className="ws-task-row">
      <div className="ws-task-row-top"><span className="ws-task-key">{task.key}</span><span className={`ws-pill ws-pill-${task.priority}`}>{task.priority}</span><span className={`ws-pill ws-pill-${task.status}`}>{task.status.replace("_", " ")}</span></div>
      <div className="ws-task-title">{task.title}</div>
      <div className="ws-task-row-bottom"><span>{task.projectName}</span><span className="ws-task-actions">
        {linkedThreadId && <button onClick={() => onOpenThread(linkedThreadId)}>Open thread</button>}
        {task.status !== "in_review" && <button type="button" disabled={updating} onClick={() => void update()}>{updating ? "Updating…" : "Ready for review"}</button>}
      </span></div>
    </article>
  );
}

type SidebarView = "work" | "tasks" | "prs";

function sidebarViewLabel(id: SidebarView): string {
  switch (id) {
    case "tasks": return "Task Queue";
    case "prs": return "PRs";
    default: return "Work";
  }
}

function WorkThreadList(props: PluginThreadListProps) {
  const Original = props.experimental_Original ?? (() => null);
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const rpc = useRpc<typeof rpcContract>();
  const [taskLinks, setTaskLinks] = useState<Record<string, ThreadTaskLink[]>>({});
  const [view, setView] = useState<SidebarView>("work");
  const [tasks, setTasks] = useState<SidebarTask[]>([]);
  const [taskState, setTaskState] = useState<"loading" | "ready" | "error">("loading");
  const [taskError, setTaskError] = useState<string | null>(null);
  const taskLinksRequest = useRef(0);
  const tasksRequest = useRef(0);
  const orderRequest = useRef(0);
  const orderMutation = useRef(0);
  const orderRef = useRef<string[]>([]);
  const [threadOrder, setThreadOrder] = useState<string[]>([]);
  const [dragThreadId, setDragThreadId] = useState<string | null>(null);
  const [pullRequestStates, setPullRequestStates] = useState<Record<string, { isLoading: boolean; pullRequest: ReturnType<typeof experimental_useSidebarThreadPullRequest>["pullRequest"] }>>({});

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
  useRealtime(SIDEBAR_ORDER_CHANNEL, () => { void refreshSidebarOrder(); });

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
  const refreshTasks = useCallback(async () => {
    const request = ++tasksRequest.current;
    setTaskState("loading");
    try {
      const result = await rpc.call("sidebarTasks", null);
      if (request !== tasksRequest.current) return;
      if (!result.available) throw new Error(result.error ?? "The official BB Tasks plugin is unavailable.");
      setTasks(result.tasks); setTaskError(null); setTaskState("ready");
    } catch (error) {
      if (request !== tasksRequest.current) return;
      setTasks([]); setTaskError(error instanceof Error ? error.message : "Could not load tasks"); setTaskState("error");
    }
  }, [rpc]);
  useEffect(() => {
    if (view === "tasks") void refreshTasks();
    return () => { tasksRequest.current += 1; };
  }, [view, refreshTasks]);

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects]);
  const filtered = useMemo(() => filterThreadsWithAncestors(threads, projectNames, props.searchQuery), [threads, projectNames, props.searchQuery]);
  const effectiveOrder = useMemo(() => reconcileThreadOrder(threadOrder, threads), [threadOrder, threads]);
  const orderedRoots = useMemo(() => rootThreads(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const childrenByThread = useMemo(() => childrenByParent(filtered, effectiveOrder), [effectiveOrder, filtered]);
  const projectsById = useMemo(() => new Map(projects.map((project) => [project.id, project])), [projects]);
  const reorderDisabled = props.searchQuery.trim().length > 0;

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

  const filteredTasks = orderTasks(tasks.filter((task) => taskMatchesSearch(task, props.searchQuery)));
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

  return (
    <div className="ws-list">
      <nav className="ws-view-selector" aria-label="Sidebar views">
        {(["work", "tasks", "prs"] as const).map((id) => <button key={id} className={view === id ? "ws-view-active" : ""} aria-pressed={view === id} onClick={() => setView(id)}>{sidebarViewLabel(id)}</button>)}
      </nav>
      {view === "tasks" && <div className="ws-view-content">
        <div className="ws-list-toolbar"><span>{filteredTasks.length} active task{filteredTasks.length === 1 ? "" : "s"}</span><button onClick={() => void refreshTasks()}>Refresh</button></div>
        {taskState === "loading" && <div className="ws-empty">Loading tasks…</div>}
        {taskState === "error" && <div className="ws-callout">{taskError ?? "Could not load tasks."}<button onClick={() => void refreshTasks()}>Try again</button></div>}
        {taskState === "ready" && filteredTasks.map((task) => <TaskRow key={task.id} task={task} onOpenThread={(threadId) => navigateToThread(threadId)} onUpdate={async (taskId, nextStatus) => { try { await rpc.call("updateTaskStatus", { taskId, status: nextStatus }); await refreshTasks(); } catch (error) { toast.error(error instanceof Error ? error.message : "Could not update task"); } }} />)}
        {taskState === "ready" && filteredTasks.length === 0 && <div className="ws-empty">{props.searchQuery ? `No tasks match “${props.searchQuery}”.` : "No active tasks."}</div>}
      </div>}
      {view === "prs" && <div className="ws-view-content">
        <div className="ws-list-toolbar"><span>{visiblePullRequestIds.length} pull request{visiblePullRequestIds.length === 1 ? "" : "s"}</span></div>
        {prThreads.map((thread) => <PullRequestRow
          key={thread.id}
          thread={thread}
          active={thread.id === props.activeThreadId}
          projectName={projectNames[thread.projectId] ?? "Personal"}
          query={props.searchQuery}
          visible={!pullRequestStates[thread.id] || pullRequestStates[thread.id]!.isLoading || visiblePullRequestIds.includes(thread.id)}
          onNavigate={props.onNavigate}
          onStateChange={(threadId, state) => setPullRequestStates((current) => {
            const previous = current[threadId];
            if (previous?.isLoading === state.isLoading && previous?.pullRequest?.url === state.pullRequest?.url && previous?.pullRequest?.title === state.pullRequest?.title && previous?.pullRequest?.attention === state.pullRequest?.attention) return current;
            return { ...current, [threadId]: state };
          })}
        />)}
        {pullRequestsSettled && visiblePullRequestIds.length === 0 && <div className="ws-empty">No pull requests match{props.searchQuery ? ` “${props.searchQuery}”` : ""}.</div>}
      </div>}
      {view === "work" && <>
      <div className="ws-list-toolbar">
        <span>{filtered.length} work item{filtered.length === 1 ? "" : "s"}</span>
        {reorderDisabled && <span className="ws-reorder-disabled" role="status">Clear search to reorder</span>}
      </div>
      <section className="ws-hierarchy" aria-label="Work threads">
        {orderedRoots.map((thread) => (
          <WorkThreadTree
            key={thread.id}
            thread={thread}
            childrenByThread={childrenByThread}
            taskLinks={taskLinks}
            activeThreadId={props.activeThreadId}
            projectsById={projectsById}
            onNavigate={props.onNavigate}
            orderedSiblings={orderedRoots}
            reorderDisabled={reorderDisabled}
            dragThreadId={dragThreadId}
            onDragThreadChange={setDragThreadId}
            onDropThread={reorder}
            onMoveThread={move}
          />
        ))}
      </section>
      {filtered.length === 0 && <div className="ws-empty">No work matches “{props.searchQuery}”.</div>}
      {props.activeProjectId && (
        <Button className="ws-new-thread" variant="outline" size="sm" onClick={() => actions.openNewThread({ projectId: props.activeProjectId!, focusPrompt: true })}>
          New thread in project
        </Button>
      )}
      <details className="ws-native-fallback"><summary>Use BB’s native list</summary><Original /></details>
      </>}
    </div>
  );
}
