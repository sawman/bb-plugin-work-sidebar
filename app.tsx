import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import {
  definePluginApp,
  useBbNavigate,
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
  experimental_useSidebarThreads,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
  useSettings,
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
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ArchivedThreadRow, type ArchivedThread } from "@/components/threads/archived-thread-row";
import { WorkCard, WorkCardHeading } from "@/components/work/card";
import { AssigneePicker } from "@/components/tasks/assignee-picker";
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
import { githubHealthPresentation, pullRequestPresentation } from "@/features/pull-requests/presentation";
import { useAuthoredPullRequests, useGitHubApiHealth, useSetAuthoredPullRequestDraft } from "@/features/pull-requests/queries";
import { changesHeaderLabel } from "@/features/changes/model";
import { invalidateChanges, useChanges } from "@/features/changes/queries";
import { ChangesError, ChangesRepositoryCard } from "@/features/changes/views";
import { changesInteractionStore } from "@/features/changes/store";
import { useTaskLinksRead, useTasksRead, useTasksRealtimeInvalidation } from "@/features/tasks/queries";
import { useTasksMutations } from "@/features/tasks/mutations";
import "./app.css";
import "./scrollbar.css";
import "./views.css";
import { PluginProviders, getPluginQueryClient, queryKeys } from "./query-runtime";
import { selectThreadIds, type SidebarThreadGroup } from "./features/threads/model";
import { threadInteractionStore, type ThreadDropTarget, type WorkTab } from "./features/threads/store";
import { useArchivedThreads, useThreadPreferences } from "./features/threads/queries";
import { WorkThreadTree, threadIsWorking, visibleThreadTreeIds } from "./features/threads/thread-row";
import { WorkContextCards } from "./features/work-context/views";
import { invalidateWorkContextCards, useLegacyProviderHealth, useLegacyWorkContext } from "./features/work-context/queries";
import { TrackerCard, TrackerHeaderBadge } from "./features/tracker/card";
import { invalidateTracker } from "./features/tracker/queries";

function withPluginProviders<Props extends object>(Component: ComponentType<Props>): ComponentType<Props> {
  return function PluginSlot(props: Props) {
    return <PluginProviders><Component {...props} /></PluginProviders>;
  };
}


type SidebarView = "work" | "queue" | "prs";
type SidebarTaskProject = { id: string; name: string };

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
  const { data: tasksData, isPending: tasksPending, isError: tasksFailed, error: tasksReadError, refetch: refetchTasks } = useTasksRead();
  const { data: taskLinksData, refetch: refetchTaskLinks } = useTaskLinksRead();
  useTasksRealtimeInvalidation();
  const { values: pluginSettings } = useSettings();
  const taskLinks = taskLinksData?.links ?? {};
  const threadPreferences = useThreadPreferences();
  const [archivedOpen, setArchivedOpen] = useState(false);
  const archivedRosterFingerprint = useMemo(() => threads.map((thread) => `${thread.id}:${thread.isArchived}`).sort().join("|"), [threads]);
  const archivedThreadQuery = useArchivedThreads(archivedOpen, archivedRosterFingerprint);
  const [view, setView] = useState<SidebarView>("work");
  const threadListMode = threadPreferences.listMode.data ?? "enhanced";
  const [threadSettingsOpen, setThreadSettingsOpen] = useState(false);
  const [activeThreadsOpen, setActiveThreadsOpen] = useState(true);
  const archivedThreads = (archivedThreadQuery.archive.data ?? []) as ArchivedThread[];
  const archivedThreadState = archivedThreadQuery.archive.isPending ? "loading" : archivedThreadQuery.archive.isError ? "error" : archivedThreadQuery.archive.isSuccess ? "ready" : "idle";
  const archivedThreadError = archivedThreadQuery.archive.error?.message ?? null;
  const tasks = tasksData?.tasks ?? [];
  const taskMutations = useTasksMutations(rpc);
  const taskProjects = tasksData?.projects ?? [];
  const taskState = tasksPending ? "loading" : tasksFailed ? "error" : "ready";
  const taskError = tasksFailed ? tasksReadError.message : null;
  const [taskComposerOpen, setTaskComposerOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newTaskProjectId, setNewTaskProjectId] = useState("");
  const [newTaskAssignee, setNewTaskAssignee] = useState<SidebarTask["assignee"]>("human");
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [taskDropTarget, setTaskDropTarget] = useState<{ taskId: string; placement: "before" | "after" } | null>(null);
  const threadOrder = threadPreferences.order.data ?? [];
  const threadGroups = threadPreferences.groups.data ?? [];
  const dragThreadId = useStore(threadInteractionStore, (state) => state.dragThreadId);
  const threadDropTarget = useStore(threadInteractionStore, (state) => state.dropTarget);
  const selectedThreadIds = useStore(threadInteractionStore, (state) => state.selectedThreadIds);
  const setDragThreadId = useCallback((threadId: string | null) => {
    const state = threadInteractionStore.getState();
    state.setDrag(threadId, state.dropTarget);
  }, []);
  const setThreadDropTarget = useCallback((dropTarget: ThreadDropTarget) => {
    const state = threadInteractionStore.getState();
    state.setDrag(state.dragThreadId, dropTarget);
  }, []);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(() => new Set());
  const [taskSelectionAnchorId, setTaskSelectionAnchorId] = useState<string | null>(null);
  const [selectedPullRequestIds, setSelectedPullRequestIds] = useState<Set<string>>(() => new Set());
  const [pullRequestSelectionAnchorId, setPullRequestSelectionAnchorId] = useState<string | null>(null);
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);
  const authoredPullRequestQuery = useAuthoredPullRequests(rpc, { intervalMs: Number(pluginSettings?.githubLeftListRefreshSeconds ?? "300") * 1_000 });
  const authoredPullRequestDraft = useSetAuthoredPullRequestDraft(rpc);
  const githubHealthQuery = useGitHubApiHealth(rpc, { poll: true });
  const authoredPullRequests = (authoredPullRequestQuery.data ?? []) as AuthoredPullRequest[];
  const authoredPullRequestState = authoredPullRequestQuery.isPending ? "loading" : authoredPullRequestQuery.isError ? "error" : "ready";
  const authoredPullRequestError = authoredPullRequestQuery.error?.message ?? null;
  const changingDraftUrl = authoredPullRequestDraft.isPending ? authoredPullRequestDraft.variables?.url ?? null : null;
  const githubApiHealth = githubHealthQuery.data ?? { state: "available" as const, scope: "unknown" as const, message: null, retryAt: null };

  useEffect(() => {
    const threadIds = threads.map((thread) => thread.id);
    threadInteractionStore.getState().reconcileRoster(threadIds);
    changesInteractionStore.getState().cleanup(threadIds);
  }, [threads]);

  const setSavedThreadListMode = (mode: "enhanced" | "native") => {
    setThreadSettingsOpen(false);
    void threadPreferences.saveListMode.mutateAsync(mode).catch(() => toast.error("Could not save thread-list preference."));
  };

  const refreshSidebarOrder = useCallback(async () => { await threadPreferences.order.refetch(); }, [threadPreferences.order]);
  const refreshThreadGroups = useCallback(async () => { await threadPreferences.groups.refetch(); }, [threadPreferences.groups]);
  const refreshArchivedThreads = useCallback(async () => {
    await archivedThreadQuery.archive.refetch();
  }, [archivedThreadQuery.archive]);
  const saveThreadGroups = useCallback((next: SidebarThreadGroup[], previous = threadGroups) => {
    void threadPreferences.saveGroups.mutateAsync(next).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not save thread groups");
    });
  }, [threadPreferences.saveGroups, threadGroups]);
  const unarchiveThread = useCallback((threadId: string, destination: string | null) => {
    void archivedThreadQuery.unarchive.mutateAsync(threadId).then(async () => {
      if (destination) saveThreadGroups(threadGroups.map((group) => group.id === destination ? { ...group, threadIds: [...new Set([...group.threadIds, threadId])] } : group));
      toast.success(`Moved to ${destination ? threadGroups.find((group) => group.id === destination)?.name ?? "group" : "Active"}`);
    }).catch((error: unknown) => toast.error(error instanceof Error ? error.message : "Could not unarchive thread"));
  }, [archivedThreadQuery.unarchive, saveThreadGroups, threadGroups]);
  const persistSidebarOrder = useCallback(async (next: string[]) => {
    try {
      await threadPreferences.saveOrder.mutateAsync(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save sidebar order");
    }
  }, [threadPreferences.saveOrder]);

  const refreshTaskLinks = useCallback(async () => { await refetchTaskLinks(); }, [refetchTaskLinks]);
  const refreshThreadDetails = useCallback(async () => {
    void refreshSidebarOrder();
    void refreshThreadGroups();
    void refreshTaskLinks();
    void refreshArchivedThreads();
    setSubtextRefreshKey((current) => current + 1);
  }, [refreshArchivedThreads, refreshThreadGroups, refreshSidebarOrder, refreshTaskLinks]);
  const refreshTasks = useCallback(async () => { await refetchTasks(); }, [refetchTasks]);
  useEffect(() => {
    if (!tasksData) return;
    setNewTaskProjectId((current) => current && tasksData.projects.some((project) => project.id === current) ? current : tasksData.projects[0]?.id ?? "");
  }, [tasksData]);

  const updateTaskStatus = useCallback(async (taskId: string, status: SidebarTask["status"]) => {
    try { await taskMutations.status.mutateAsync({ taskId, status }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not update task"); }
  }, [taskMutations.status]);
  const updateTaskAssignee = useCallback(async (taskId: string, assignee: SidebarTask["assignee"]) => {
    try { await taskMutations.assignment.mutateAsync({ taskId, assignee }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not update task assignee"); }
  }, [taskMutations.assignment]);
  const createSidebarTask = useCallback(async () => {
    const title = newTaskTitle.trim();
    if (!title || !newTaskProjectId || taskMutations.create.isPending) return;
    try {
      await taskMutations.create.mutateAsync({ projectId: newTaskProjectId, title, assignee: newTaskAssignee });
      setNewTaskTitle(""); setTaskComposerOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create task");
    }
  }, [newTaskAssignee, newTaskProjectId, newTaskTitle, taskMutations.create]);
  const deleteSidebarTask = useCallback(async (task: SidebarTask) => {
    if (!window.confirm(`Delete ${task.key}: ${task.title}? This cannot be undone.`)) return;
    try {
      await taskMutations.remove.mutateAsync({ taskId: task.id });
      setSelectedTaskIds((current) => { const next = new Set(current); next.delete(task.id); return next; });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete task");
    }
  }, [taskMutations.remove]);
  const updateTaskThreadAttachment = useCallback(async (taskId: string, threadId: string, attached: boolean) => {
    try { await taskMutations.attachment.mutateAsync({ taskId, threadId, attached }); }
    catch (error) {
      toast.error(error instanceof Error ? error.message : `Could not ${attached ? "attach" : "detach"} task`);
    }
  }, [taskMutations.attachment]);

  const persistTaskReorder = useCallback(async (sourceId: string, targetId: string, placement: "before" | "after") => {
    if (props.searchQuery.trim()) return;
    const neighbors = taskReorderNeighbors(tasks, sourceId, targetId, placement);
    if (!neighbors) return;
    setTaskDropTarget(null); setDragTaskId(null);
    try { await taskMutations.reorder.mutateAsync({ taskId: sourceId, ...neighbors }); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not save task order"); }
  }, [props.searchQuery, taskMutations.reorder, tasks]);

  const moveTask = useCallback((taskId: string, direction: -1 | 1) => {
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (!task) return;
    const peers = tasks.filter((candidate) => candidate.projectId === task.projectId && candidate.status === task.status && candidate.parentTaskId === task.parentTaskId).sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER));
    const target = peers[peers.findIndex((candidate) => candidate.id === taskId) + direction];
    if (target) void persistTaskReorder(taskId, target.id, direction < 0 ? "before" : "after");
  }, [persistTaskReorder, tasks]);

  const projectNames = useMemo(() => Object.fromEntries(projects.map((project) => [project.id, project.name])), [projects]);
  const effectiveOrder = useMemo(() => reconcileThreadOrder(threadOrder, threads), [threadOrder, threads]);
  const allChildrenByThread = useMemo(() => childrenByParent(threads, effectiveOrder), [effectiveOrder, threads]);
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
    const state = threadInteractionStore.getState();
    const next = selectThreadIds(state.selectedThreadIds, state.selectionAnchorId, visibleThreadIds, thread.id, {
      toggle: event.ctrlKey || event.metaKey,
      range: event.shiftKey,
    });
    state.setSelected(next.anchorId, next.selectedIds);
    return next.handled;
  }, [visibleThreadIds]);
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
    threadInteractionStore.getState().setSelected(null, []);
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
  const activeSidebarThread = props.activeThreadId ? threads.find((thread) => thread.id === props.activeThreadId) ?? null : null;
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
    if (authoredPullRequestDraft.isPending) return;
    authoredPullRequestDraft.mutate({ url: pullRequest.url, draft: !pullRequest.draft }, { onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not update pull request state");
    }});
  }, [authoredPullRequestDraft]);
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

  const githubHealth = githubHealthPresentation(githubApiHealth);
  const githubHealthIndicator = githubHealth ? <span className={`ws-github-api-indicator ws-github-api-${githubHealth.tone}`} title={githubApiHealth.message ?? githubHealth.label}><Icon name={githubHealth.icon} aria-hidden />{githubHealth.label}</span> : null;
  const viewToolbar = view === "queue" ? <><span>{filteredTasks.length} active task{filteredTasks.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedTaskIds.size > 1 && <span className="ws-selection-count" role="status">{selectedTaskIds.size} selected</span>}<button className="ws-icon-button" title="Add task" aria-label="Add task" disabled={!taskProjects.length} onClick={() => setTaskComposerOpen((open) => !open)}><Icon name="Plus" aria-hidden /></button><button className="ws-icon-button" title="Refresh tasks" aria-label="Refresh tasks" onClick={() => void refreshTasks()}><Icon name="RefreshCw" aria-hidden /></button></span></> : view === "prs" ? <><span>{visibleAuthoredPullRequests.length} open pull request{visibleAuthoredPullRequests.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{githubHealthIndicator}{selectedPullRequestIds.size > 1 && <span className="ws-selection-count" role="status">{selectedPullRequestIds.size} selected</span>}<button className="ws-icon-button" title="Refresh pull requests" aria-label="Refresh pull requests" disabled={authoredPullRequestQuery.isFetching} onClick={() => { void authoredPullRequestQuery.refresh().catch(() => undefined); }}><Icon name="RefreshCw" aria-hidden /></button></span></> : <><span>{threadListMode === "native" ? "Threads" : `${filtered.length} thread${filtered.length === 1 ? "" : "s"}`}</span><span className="ws-work-toolbar-actions">{threadListMode === "enhanced" && <>{selectedThreadIds.size > 1 && <><span className="ws-selection-count" role="status">{selectedThreadIds.size} selected</span><button className="ws-selection-archive" onClick={() => void archiveSelected()}>Archive selected</button></>}{reorderDisabled && <span className="ws-reorder-disabled" role="status">Clear search to reorder</span>}</>}<span className="ws-thread-settings"><button className="ws-icon-button" title="Thread list settings" aria-label="Thread list settings" aria-expanded={threadSettingsOpen} onClick={() => setThreadSettingsOpen((open) => !open)}><Icon name="Wrench" aria-hidden /></button>{threadSettingsOpen && <span className="ws-thread-settings-menu" role="menu"><button role="menuitemradio" aria-checked={threadListMode === "enhanced"} onClick={() => setSavedThreadListMode("enhanced")}>Enhanced list</button><button role="menuitemradio" aria-checked={threadListMode === "native"} onClick={() => setSavedThreadListMode("native")}>BB native list</button><span className="ws-thread-group-settings"><b>Custom groups</b>{threadGroups.map((group) => <span key={group.id}><button title={`Rename ${group.name}`} onClick={() => renameThreadGroup(group)}>{group.name}</button><button className="ws-thread-group-remove" title={[...threadGroupIds.values()].includes(group.id) ? "Move its threads before removing" : `Remove ${group.name}`} disabled={[...threadGroupIds.values()].includes(group.id)} onClick={() => removeThreadGroup(group)}><Icon name="X" aria-hidden /></button></span>)}<button className="ws-thread-group-add" onClick={addThreadGroup}>Add group</button></span></span>}</span><button className="ws-icon-button" title="Refresh threads" aria-label="Refresh threads" onClick={() => void refreshThreadDetails()}><Icon name="RefreshCw" aria-hidden /></button>{props.activeProjectId && <Button className="ws-new-thread" variant="ghost" size="icon" title="New thread in project" aria-label="New thread in project" onClick={() => actions.openNewThread({ projectId: props.activeProjectId!, focusPrompt: true })}><Icon name="Plus" aria-hidden /></Button>}</span></>;

  return (
    <div className="ws-list">
      <nav className="ws-view-selector" aria-label="Sidebar views">
        {(["work", "queue", "prs"] as const).map((id) => <button key={id} className={view === id ? "ws-view-active" : ""} aria-pressed={view === id} onClick={() => setView(id)}>{sidebarViewLabel(id)}</button>)}
      </nav>
      <div className="ws-list-toolbar">{viewToolbar}</div>
      {view === "queue" && <div className="ws-view-content">
        {taskComposerOpen && <form className="ws-task-composer" onSubmit={(event) => { event.preventDefault(); void createSidebarTask(); }}><Input autoFocus value={newTaskTitle} placeholder="Task title" onChange={(event) => setNewTaskTitle(event.target.value)} /><Combobox value={newTaskProjectId} options={taskProjects.map((project) => ({ value: project.id, label: project.name }))} onChange={setNewTaskProjectId} placeholder="Project" ariaLabel="Task project" /><Combobox value={newTaskAssignee} options={[{ value: "human", label: "Human" }, { value: "agent", label: "Agent" }]} onChange={(value) => setNewTaskAssignee(value as SidebarTask["assignee"])} placeholder="Assignee" ariaLabel="Task assignee" /><button type="submit" disabled={!newTaskTitle.trim() || !newTaskProjectId || taskMutations.create.isPending}>{taskMutations.create.isPending ? "Adding…" : "Add"}</button><button type="button" onClick={() => setTaskComposerOpen(false)}>Cancel</button></form>}
        {taskState === "loading" && <div className="ws-empty" role="status" aria-live="polite" aria-busy="true">Loading tasks…</div>}
        {taskState === "error" && <div className="ws-callout" role="alert">{taskError ?? "Could not load tasks."}<button onClick={() => void refreshTasks()}>Try again</button></div>}
        {taskState === "ready" && taskQueue.map((node) => <SidebarTaskRow key={node.task.id} node={node} siblings={taskQueue} showProject={(taskKeys.get(node.task.key) ?? 0) > 1} reorderDisabled={reorderDisabled} dragTaskId={dragTaskId} dropTarget={taskDropTarget} onDragTaskChange={setDragTaskId} onDragTargetChange={(taskId, placement) => setTaskDropTarget(taskId && placement ? { taskId, placement } : null)} onDropTask={(sourceId, targetId, placement) => void persistTaskReorder(sourceId, targetId, placement)} onMoveTask={moveTask} onOpenThread={navigateToThread} onUpdateStatus={updateTaskStatus} onUpdateAssignee={updateTaskAssignee} onDelete={deleteSidebarTask} activeThreadId={props.activeThreadId} activeThreadTitle={activeSidebarThread ? threadTitle(activeSidebarThread) : null} onAttachToThread={(taskId, threadId) => updateTaskThreadAttachment(taskId, threadId, true)} onDetachFromThread={(taskId, threadId) => updateTaskThreadAttachment(taskId, threadId, false)} updatingTaskId={taskMutations.status.isPending ? taskMutations.status.variables?.taskId ?? null : null} selectedTaskIds={selectedTaskIds} onSelect={selectTask} />)}
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
      <details className="ws-later ws-archived" data-ws-thread-drop-zone="archive" data-drop-target={threadDropTarget?.threadId === "archive" || undefined} open={archivedOpen} onToggle={(event) => setArchivedOpen(event.currentTarget.open)} onDragOver={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || archivedThreadIds.has(sourceId)) return; event.preventDefault(); event.dataTransfer.dropEffect = "move"; setThreadDropTarget({ threadId: "archive", placement: "after" }); }} onDrop={(event) => { const sourceId = dragThreadId ?? event.dataTransfer.getData("text/plain"); if (!sourceId || archivedThreadIds.has(sourceId)) return; event.preventDefault(); if (threadGroupIds.has(sourceId)) moveThreadToGroup(sourceId, null); actions.archive(sourceId); setDragThreadId(null); setThreadDropTarget(null); }}><summary>Archive <span>{archivedThreadState === "ready" ? archivedThreads.length : ""}</span></summary>{archivedThreadState === "idle" || archivedThreadState === "loading" ? <div className="ws-later-empty">Loading archive threads…</div> : archivedThreadState === "error" ? <div className="ws-callout">{archivedThreadError ?? "Could not load archive threads."}<button onClick={() => void refreshArchivedThreads()}>Try again</button></div> : archivedThreads.length > 0 ? <section className="ws-hierarchy" aria-label="Archive threads">{archivedThreads.map((thread) => <ArchivedThreadRow key={thread.id} thread={thread} project={projectsById.get(thread.projectId)} groups={threadGroups} onUnarchive={unarchiveThread} onNavigate={props.onNavigate} onDragThreadChange={setDragThreadId} onDropTargetChange={() => setThreadDropTarget(null)} />)}</section> : <div className="ws-later-empty">No archive threads.</div>}</details>
      </section>
      {filtered.length === 0 && <div className="ws-empty">{props.searchQuery ? `No threads match “${props.searchQuery}”.` : "No active threads."}</div>}
      </>}
      </>}
    </div>
  );
}

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
type WorkProviderHealth = { tone: "green" | "amber" | "red"; providerId: string; providerName: string; statusUrl: string | null; status: string; message: string | null };

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
  const { data: tasksData, isPending: tasksReadPending, isError: tasksReadFailed, error: tasksReadError, refetch: refetchTasks } = useTasksRead();
  const queryClient = useQueryClient();
  const taskMutations = useTasksMutations(rpc);
  const { values: pluginSettings } = useSettings();
  const changesQuery = useChanges(rpc, threadId, {
    visiblePollMs: Number(pluginSettings?.githubActivePollSeconds ?? "60") * 1_000,
    backgroundPollMs: Number(pluginSettings?.githubBackgroundPollSeconds ?? "300") * 1_000,
  });
  const githubHealthQuery = useGitHubApiHealth(rpc, { poll: false });
  const githubApiHealth = githubHealthQuery.data ?? { state: "available" as const, scope: "unknown" as const, message: null, retryAt: null };
  const navigate = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();
  const tab = useStore(threadInteractionStore, (state) => state.workTabsByThread.get(threadId) ?? "work");
  useEffect(() => {
    threadInteractionStore.getState().touchWorkTab(threadId);
    return () => changesInteractionStore.getState().selectFile(threadId, null);
  }, [threadId]);
  const legacyContext = useLegacyWorkContext(threadId);
  const legacyProviderHealth = useLegacyProviderHealth(threadId);
  const context = legacyContext.data;
  const loading = legacyContext.isPending;
  const changesLoading = changesQuery.isPending;
  const providerHealth: WorkProviderHealth = legacyProviderHealth.data ?? { tone: "amber", providerId: "", providerName: "Provider", statusUrl: null, status: "unknown", message: "Checking provider health…" };
  const error = legacyContext.error?.message ?? null;
  const changesPresentation = useStore(changesInteractionStore, (state) => state.byThread.get(threadId));
  const pendingChangesExpanded = changesPresentation?.repositoryExpanded ?? false;
  const currentPrExpanded = changesPresentation?.currentPullRequestExpanded ?? false;
  const expandedStackBranches = changesPresentation?.expandedStackBranches ?? new Set<string>();
  const [checkingOutBranch, setCheckingOutBranch] = useState<string | null>(null);
  const [workingTreeDiff, setWorkingTreeDiff] = useState<{ identity: string; patch: string | null; loading: boolean; message: string | null } | null>(null);

  const refresh = () => legacyContext.refetch();
  const refreshChanges = () => changesQuery.refetch();
  const refreshProviderHealth = () => legacyProviderHealth.refetch();
  const refreshWorkPanel = () => { void refresh(); void invalidateWorkContextCards(queryClient, threadId); void invalidateTracker(queryClient, threadId); void invalidateChanges(queryClient, threadId); void refreshProviderHealth(); };
  useRealtime("work-sidebar:changed", refreshWorkPanel);

  const openWorkingTreeDiff = async (path: string) => {
    const identity = `${threadId}:${path}`;
    changesInteractionStore.getState().selectFile(threadId, path);
    setWorkingTreeDiff({ identity, patch: null, loading: true, message: null });
    try {
      const result = await rpc.call("getWorkingTreeFileDiff", { threadId, path });
      setWorkingTreeDiff((current) => current?.identity === identity ? { identity, patch: result.patch, loading: false, message: result.message } : current);
    } catch (error) {
      setWorkingTreeDiff((current) => current?.identity === identity ? { identity, patch: null, loading: false, message: error instanceof Error ? error.message : "Could not load the file diff." } : current);
    }
  };

  const selectedTab = WORK_TABS.find((candidate) => candidate.id === tab) ?? WORK_TABS[0]!;
  const selectTab = (next: WorkTab) => threadInteractionStore.getState().setWorkTab(threadId, next);
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
  const bindings = context?.bindings ?? [];
  const toggleStackBranch = (branch: string) => changesInteractionStore.getState().toggleStackBranch(threadId, branch);
  const checkoutStackBranch = async (branch: string) => {
    if (checkingOutBranch) return;
    setCheckingOutBranch(branch);
    try { const result = await rpc.call("checkoutStackBranch", { threadId, branch }); result.ok ? toast.success(result.message) : toast.error(result.message); await Promise.all([refresh(), refreshChanges()]); }
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
        <button type="button" className="ws-icon-button" aria-label="Refresh work context" title="Refresh work context" onClick={() => { refreshWorkPanel(); void githubHealthQuery.refetch(); }} disabled={loading}>↻</button>
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
        {!loading && error && <div className="ws-callout" role="alert"><span>{error}</span><button type="button" onClick={() => { void refresh(); void refreshChanges(); void refreshProviderHealth(); void githubHealthQuery.refetch(); }}>Try again</button></div>}
        {tab === "work" && (
          <div className="ws-section-stack">
            <header><div><h2>Work</h2></div><span className="ws-work-header-badges"><TrackerHeaderBadge threadId={threadId} /></span></header>
            <WorkContextCards threadId={threadId} />
            <TrackerCard threadId={threadId} />
          </div>
        )}
        {!loading && context && tab === "changes" && (
          <div className="ws-section-stack">
            <header><div><h2>Changes</h2></div><span className="ws-section-count">{githubApiHealth.state !== "available" && <span className={`ws-github-api-indicator ws-github-api-${githubApiHealth.state}`} title={githubApiHealth.message ?? "GitHub API is unavailable."}><Icon name="AlertCircle" aria-hidden />{githubApiHealth.scope === "graphql" ? "GraphQL limited" : "GitHub unavailable"}</span>}{changesLoading ? "Loading…" : changesHeaderLabel(changesQuery.data, changesQuery.isPending, changesQuery.isError)}</span></header>
            <ChangesRepositoryCard repository={changesQuery.data?.repository} loading={changesLoading} expanded={pendingChangesExpanded} onToggle={() => changesInteractionStore.getState().toggleRepository(threadId)} onOpenFile={openWorkingTreeDiff} />
            {workingTreeDiff && changesPresentation?.selectedFilePath && workingTreeDiff.identity === `${threadId}:${changesPresentation.selectedFilePath}` && <article className="ws-card ws-working-tree-diff"><div className="ws-card-heading"><strong>{changesPresentation.selectedFilePath}</strong><button type="button" className="ws-text-button" onClick={() => { changesInteractionStore.getState().selectFile(threadId, null); setWorkingTreeDiff(null); }}>Close</button></div>{workingTreeDiff.loading ? <p className="ws-card-note">Loading diff…</p> : workingTreeDiff.patch ? <ChangesWorkingTreeDiff patch={workingTreeDiff.patch} /> : <p className="ws-card-note">{workingTreeDiff.message ?? "No diff is available for this file."}</p>}</article>}
            {changesQuery.isError && <ChangesError error={changesQuery.error} onRetry={() => { void changesQuery.refetch(); }} />}
            {!changesQuery.isPending && !changesQuery.isError && (changesQuery.data?.githubStack?.stack ? <ol className="ws-stack-rail" aria-label={`GitHub Stack based on ${changesQuery.data.githubStack.stack.trunk}`}>
              {changesQuery.data.githubStack.stack.branches.map((branch: any) => { const stackPullRequest = changesQuery.data?.stack?.pullRequests.find((pullRequest: any) => pullRequest.number === branch.pr?.number || pullRequest.head === branch.name); const current = branch.pr?.number === changesQuery.data?.currentPullRequest?.number ? changesQuery.data.currentPullRequest : null; const signals = current ? { ...stackPullRequest, state: current.state, draft: current.state === "draft", ...current.signal } : branch.pr ? { ...stackPullRequest, state: stackPullRequest?.state ?? branch.pr.state, draft: stackPullRequest?.draft ?? branch.pr.isDraft, checks: branch.checks ?? stackPullRequest?.checks ?? "unknown", review: branch.review ?? stackPullRequest?.review ?? "none", reviewCommentCount: stackPullRequest?.reviewCommentCount ?? 0 } : stackPullRequest; return <ChangesStackBranchRow key={branch.name} branch={branch} signals={signals} expanded={expandedStackBranches.has(branch.name)} checkingOut={checkingOutBranch === branch.name} onToggle={() => toggleStackBranch(branch.name)} onCheckout={() => void checkoutStackBranch(branch.name)} />; })}
            </ol> : changesQuery.data?.currentPullRequest ? <ChangesPullRequestCard pullRequest={changesQuery.data.currentPullRequest} expanded={currentPrExpanded} onToggle={() => changesInteractionStore.getState().togglePullRequest(threadId)} /> : <div className="ws-empty">No pull request is linked to this thread.</div>)}
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

function GitHubPollingSettings() {
  const { values, isLoading } = useSettings();
  return <section className="ws-settings-card"><strong>GitHub polling</strong><p>Right Work polling checks only the current PR through REST; the left PR list refreshes independently. GraphQL remains reserved for batch metadata.</p>{!isLoading && <small>Current policy: right every {values?.githubActivePollSeconds ?? "60"}s visible / {values?.githubBackgroundPollSeconds ?? "300"}s hidden; left every {values?.githubLeftListRefreshSeconds ?? "300"}s; up to {values?.githubMaxRestPollsPerMinute ?? "30"} REST polls/minute.</small>}</section>;
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
  app.slots.settingsSection({ id: "github-polling", title: "GitHub polling", description: "Control Work Sidebar GitHub polling and shared REST budget.", component: withPluginProviders(GitHubPollingSettings) });
  app.slots.experimental_threadList({
    id: "work-queue", title: "Tasks", description: "Global outcome and execution task queue.", component: withPluginProviders(WorkThreadList),
  });
  app.slots.threadPanelAction({
    id: "work-context", title: "Work", icon: "ListTodo", component: withPluginProviders(WorkPanel), layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "work-context-header", title: "Work", component: withPluginProviders(WorkContextHeaderAction),
  });
  app.composer.customize({
    id: "task-first", scopes: ["thread"], actions: [{ id: "track-work", component: withPluginProviders(TrackWorkAction) }],
  });
});
