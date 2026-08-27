import { useCallback, useEffect, useMemo, useState, type MouseEvent as ReactMouseEvent } from "react";
import { useStore } from "zustand";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Combobox } from "@/components/ui/combobox";
import { ArchivedThreadRow, type ArchivedThread } from "@/components/threads/archived-thread-row";
import { AuthoredPullRequestRow as AuthoredPrRow, AuthoredPullRequestStack as AuthoredPrStack, type AuthoredPullRequest } from "@/components/threads/authored-pull-requests";
import { TaskRow as SidebarTaskRow } from "@/components/threads/task-row";
import type { rpcContract } from "../../contracts";
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
  taskReorderNeighbors,
  orderTaskLinksByRelevance,
  projectTaskQueue,
  taskMatchesSearch,
  type SidebarTask,
  orderStackLayers,
  type SidebarStack,
} from "../../work-model";
import { Icon } from "@/components/ui/icon";
import { githubHealthPresentation } from "@/features/pull-requests/presentation";
import { useAuthoredPullRequests, useGitHubApiHealth, useSetAuthoredPullRequestDraft } from "@/features/pull-requests/queries";
import { changesInteractionStore } from "@/features/changes/store";
import { useTaskLinksRead, useTasksRead, useTasksRealtimeInvalidation } from "@/features/tasks/queries";
import { useTasksMutations } from "@/features/tasks/mutations";
import "../../app.css";
import "../../scrollbar.css";
import "../../views.css";
import { selectThreadIds, sidebarViewLabel, type SidebarThreadGroup, type SidebarView } from "./model";
import { threadInteractionStore, type ThreadDropTarget } from "./store";
import { useArchivedThreads, useThreadPreferences } from "./queries";
import { WorkThreadTree, visibleThreadTreeIds } from "./thread-row";

type SidebarTaskProject = { id: string; name: string };
function EmptyOriginal() { return null; }

export function WorkThreadList(props: PluginThreadListProps) {
  const Original = props.Original ?? props.experimental_Original ?? EmptyOriginal;
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
  const threadOrder = threadPreferences.order.data ?? [];
  const threadGroups = threadPreferences.groups.data ?? [];
  const dragThreadId = useStore(threadInteractionStore, (state) => state.dragThreadId);
  const threadDropTarget = useStore(threadInteractionStore, (state) => state.dropTarget);
  const selectedThreadIds = useStore(threadInteractionStore, (state) => state.selectedThreadIds);
  const selectedTaskIds = useStore(threadInteractionStore, (state) => state.selectedTaskIds);
  const taskSelectionAnchorId = useStore(threadInteractionStore, (state) => state.taskSelectionAnchorId);
  const selectedPullRequestIds = useStore(threadInteractionStore, (state) => state.selectedPullRequestIds);
  const pullRequestSelectionAnchorId = useStore(threadInteractionStore, (state) => state.pullRequestSelectionAnchorId);
  const dragTaskId = useStore(threadInteractionStore, (state) => state.dragTaskId);
  const taskDropTarget = useStore(threadInteractionStore, (state) => state.taskDropTarget);
  const setDragThreadId = useCallback((threadId: string | null) => {
    const state = threadInteractionStore.getState();
    state.setDrag(threadId, state.dropTarget);
  }, []);
  const setThreadDropTarget = useCallback((dropTarget: ThreadDropTarget) => {
    const state = threadInteractionStore.getState();
    state.setDrag(state.dragThreadId, dropTarget);
  }, []);
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
  useEffect(() => {
    threadInteractionStore.getState().reconcileLeftSidebarRoster(
      tasks.map((task) => task.id),
      authoredPullRequests.map((pullRequest) => pullRequest.url),
    );
  }, [authoredPullRequestQuery.data, tasksData?.tasks]);

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
      const state = threadInteractionStore.getState();
      state.setTaskSelected(
        state.taskSelectionAnchorId === task.id ? null : state.taskSelectionAnchorId,
        [...state.selectedTaskIds].filter((id) => id !== task.id),
      );
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
    threadInteractionStore.getState().setTaskDrag(null, null);
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
    authoredPullRequestDraft.mutate({ url: pullRequest.url, draft: !pullRequest.draft }, { onError: (error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Could not update pull request state");
    }});
  }, [authoredPullRequestDraft.mutate]);
  const visibleTaskIds = taskQueue.flatMap((node) => [node.task.id, ...node.children.map((child) => child.id)]);
  const selectTask = (taskId: string, event: ReactMouseEvent<HTMLButtonElement>): boolean => {
    const toggle = event.ctrlKey || event.metaKey;
    if (event.shiftKey && taskSelectionAnchorId) {
      const first = visibleTaskIds.indexOf(taskSelectionAnchorId);
      const last = visibleTaskIds.indexOf(taskId);
      if (first >= 0 && last >= 0) threadInteractionStore.getState().setTaskSelected(taskSelectionAnchorId, visibleTaskIds.slice(Math.min(first, last), Math.max(first, last) + 1));
      else threadInteractionStore.getState().setTaskSelected(taskId, [taskId]);
      return true;
    }
    if (toggle) {
      const state = threadInteractionStore.getState();
      const next = new Set(state.selectedTaskIds);
      if (next.has(taskId)) next.delete(taskId); else next.add(taskId);
      state.setTaskSelected(taskId, next);
      return true;
    }
    threadInteractionStore.getState().setTaskSelected(taskId, [taskId]);
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
      if (first >= 0 && last >= 0) threadInteractionStore.getState().setPullRequestSelected(pullRequestSelectionAnchorId, visibleAuthoredPullRequestIds.slice(Math.min(first, last), Math.max(first, last) + 1));
      else threadInteractionStore.getState().setPullRequestSelected(pullRequestId, [pullRequestId]);
      return true;
    }
    if (toggle) {
      const state = threadInteractionStore.getState();
      const next = new Set(state.selectedPullRequestIds);
      if (next.has(pullRequestId)) next.delete(pullRequestId); else next.add(pullRequestId);
      state.setPullRequestSelected(pullRequestId, next);
      return true;
    }
    threadInteractionStore.getState().setPullRequestSelected(pullRequestId, [pullRequestId]);
    return false;
  };

  const githubHealth = githubHealthPresentation(githubApiHealth);
  const githubHealthIndicator = githubHealth ? <span className={`ws-github-api-indicator ws-github-api-${githubHealth.tone}`} title={githubApiHealth.message ?? githubHealth.label}><Icon name={githubHealth.icon} aria-hidden />{githubHealth.label}</span> : null;
  const viewToolbar = view === "queue" ? <><span>{filteredTasks.length} active task{filteredTasks.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{selectedTaskIds.size > 1 && <span className="ws-selection-count" role="status">{selectedTaskIds.size} selected</span>}<button className="ws-icon-button" title="Add task" aria-label="Add task" disabled={!taskProjects.length} onClick={() => setTaskComposerOpen((open) => !open)}><Icon name="Plus" aria-hidden /></button><button className="ws-icon-button" title="Refresh tasks" aria-label="Refresh tasks" onClick={() => void refreshTasks()}><Icon name="RefreshCw" aria-hidden /></button></span></> : view === "prs" ? <><span>{visibleAuthoredPullRequests.length} open pull request{visibleAuthoredPullRequests.length === 1 ? "" : "s"}</span><span className="ws-work-toolbar-actions">{githubHealthIndicator}{selectedPullRequestIds.size > 1 && <span className="ws-selection-count" role="status">{selectedPullRequestIds.size} selected</span>}<button className="ws-icon-button" title="Refresh pull requests" aria-label="Refresh pull requests" disabled={authoredPullRequestQuery.isFetching} onClick={() => { void authoredPullRequestQuery.refresh().catch(() => undefined); }}><Icon name="RefreshCw" aria-hidden /></button></span></> : <><span>{threadListMode === "native" ? "Threads" : `${filtered.length} thread${filtered.length === 1 ? "" : "s"}`}</span><span className="ws-work-toolbar-actions">{threadListMode === "enhanced" && <>{selectedThreadIds.size > 1 && <><span className="ws-selection-count" role="status">{selectedThreadIds.size} selected</span><button className="ws-selection-archive" onClick={() => void archiveSelected()}>Archive selected</button></>}{reorderDisabled && <span className="ws-reorder-disabled" role="status">Clear search to reorder</span>}</>}<span className="ws-thread-settings"><button className="ws-icon-button" title="Thread list settings" aria-label="Thread list settings" aria-expanded={threadSettingsOpen} onClick={() => setThreadSettingsOpen((open) => !open)}><Icon name="Wrench" aria-hidden /></button>{threadSettingsOpen && <span className="ws-thread-settings-menu" role="menu"><button role="menuitemradio" aria-checked={threadListMode === "enhanced"} onClick={() => setSavedThreadListMode("enhanced")}>Enhanced list</button><button role="menuitemradio" aria-checked={threadListMode === "native"} onClick={() => setSavedThreadListMode("native")}>BB native list</button><span className="ws-thread-group-settings"><b>Custom groups</b>{threadGroups.map((group) => <span key={group.id}><button title={`Rename ${group.name}`} onClick={() => renameThreadGroup(group)}>{group.name}</button><button className="ws-thread-group-remove" title={[...threadGroupIds.values()].includes(group.id) ? "Move its threads before removing" : `Remove ${group.name}`} aria-label={`Remove ${group.name}`} disabled={[...threadGroupIds.values()].includes(group.id)} onClick={() => removeThreadGroup(group)}><Icon name="X" aria-hidden /></button></span>)}<button className="ws-thread-group-add" onClick={addThreadGroup}>Add group</button></span></span>}</span><button className="ws-icon-button" title="Refresh threads" aria-label="Refresh threads" onClick={() => void refreshThreadDetails()}><Icon name="RefreshCw" aria-hidden /></button>{props.activeProjectId && <Button className="ws-new-thread" variant="ghost" size="icon" title="New thread in project" aria-label="New thread in project" onClick={() => actions.openNewThread({ projectId: props.activeProjectId!, focusPrompt: true })}><Icon name="Plus" aria-hidden /></Button>}</span></>;

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
        {taskState === "ready" && taskQueue.map((node) => <SidebarTaskRow key={node.task.id} node={node} siblings={taskQueue} showProject={(taskKeys.get(node.task.key) ?? 0) > 1} reorderDisabled={reorderDisabled} dragTaskId={dragTaskId} dropTarget={taskDropTarget} onDragTaskChange={(taskId) => threadInteractionStore.getState().setTaskDrag(taskId, threadInteractionStore.getState().taskDropTarget)} onDragTargetChange={(taskId, placement) => threadInteractionStore.getState().setTaskDrag(threadInteractionStore.getState().dragTaskId, taskId && placement ? { taskId, placement } : null)} onDropTask={(sourceId, targetId, placement) => void persistTaskReorder(sourceId, targetId, placement)} onMoveTask={moveTask} onOpenThread={navigateToThread} onUpdateStatus={updateTaskStatus} onUpdateAssignee={updateTaskAssignee} onDelete={deleteSidebarTask} activeThreadId={props.activeThreadId} activeThreadTitle={activeSidebarThread ? threadTitle(activeSidebarThread) : null} onAttachToThread={(taskId, threadId) => updateTaskThreadAttachment(taskId, threadId, true)} onDetachFromThread={(taskId, threadId) => updateTaskThreadAttachment(taskId, threadId, false)} updatingTaskId={taskMutations.status.isPending ? taskMutations.status.variables?.taskId ?? null : null} selectedTaskIds={selectedTaskIds} onSelect={selectTask} />)}
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
