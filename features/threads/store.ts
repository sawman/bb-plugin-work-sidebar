import { createStore } from "zustand/vanilla";

export type WorkTab = "work" | "changes" | "agents";
export type ThreadDropTarget = { threadId: string; placement: "before" | "after" } | null;
export type TaskDropTarget = { taskId: string; placement: "before" | "after" } | null;

const MAX_THREAD_VIEW_ENTRIES = 40;

export type ThreadInteractionState = {
  selectedThreadIds: Set<string>;
  selectionAnchorId: string | null;
  expandedThreadIds: Set<string>;
  dragThreadId: string | null;
  dropTarget: ThreadDropTarget;
  selectedTaskIds: Set<string>;
  taskSelectionAnchorId: string | null;
  selectedPullRequestIds: Set<string>;
  pullRequestSelectionAnchorId: string | null;
  dragTaskId: string | null;
  taskDropTarget: TaskDropTarget;
  workTabsByThread: Map<string, WorkTab>;
  setSelected(anchorId: string | null, ids: Iterable<string>): void;
  toggleChildren(threadId: string): void;
  setDrag(threadId: string | null, target: ThreadDropTarget): void;
  setTaskSelected(anchorId: string | null, ids: Iterable<string>): void;
  setPullRequestSelected(anchorId: string | null, ids: Iterable<string>): void;
  setTaskDrag(taskId: string | null, target: TaskDropTarget): void;
  setWorkTab(threadId: string, tab: WorkTab): void;
  touchWorkTab(threadId: string): void;
  workTabFor(threadId: string): WorkTab;
  reconcileRoster(threadIds: Iterable<string>): void;
  reconcileLeftSidebarRoster(taskIds: Iterable<string>, pullRequestIds: Iterable<string>): void;
};

function cappedWorkTabs(entries: Iterable<[string, WorkTab]>): Map<string, WorkTab> {
  const next = new Map(entries);
  while (next.size > MAX_THREAD_VIEW_ENTRIES) next.delete(next.keys().next().value!);
  return next;
}

/** A fresh frontend generation always creates this non-persisted UI-only store. */
export function createThreadInteractionStore() {
  return createStore<ThreadInteractionState>((set, get) => ({
    selectedThreadIds: new Set(),
    selectionAnchorId: null,
    expandedThreadIds: new Set(),
    dragThreadId: null,
    dropTarget: null,
    selectedTaskIds: new Set(),
    taskSelectionAnchorId: null,
    selectedPullRequestIds: new Set(),
    pullRequestSelectionAnchorId: null,
    dragTaskId: null,
    taskDropTarget: null,
    workTabsByThread: new Map(),
    setSelected: (selectionAnchorId, ids) => set({ selectedThreadIds: new Set(ids), selectionAnchorId }),
    toggleChildren: (threadId) => set((current) => {
      const expandedThreadIds = new Set(current.expandedThreadIds);
      if (expandedThreadIds.has(threadId)) expandedThreadIds.delete(threadId); else expandedThreadIds.add(threadId);
      return { expandedThreadIds };
    }),
    setDrag: (dragThreadId, dropTarget) => set({ dragThreadId, dropTarget }),
    setTaskSelected: (taskSelectionAnchorId, ids) => set({
      selectedTaskIds: new Set(ids),
      taskSelectionAnchorId,
    }),
    setPullRequestSelected: (pullRequestSelectionAnchorId, ids) => set({
      selectedPullRequestIds: new Set(ids),
      pullRequestSelectionAnchorId,
    }),
    setTaskDrag: (dragTaskId, taskDropTarget) => set({
      dragTaskId,
      taskDropTarget,
    }),
    setWorkTab: (threadId, tab) => set((current) => {
      const workTabsByThread = new Map(current.workTabsByThread);
      workTabsByThread.delete(threadId);
      workTabsByThread.set(threadId, tab);
      return { workTabsByThread: cappedWorkTabs(workTabsByThread) };
    }),
    // Access is intentionally explicit so React renders stay pure. Consumers
    // touch an existing entry in an effect after mount or thread switching.
    touchWorkTab: (threadId) => set((current) => {
      const tab = current.workTabsByThread.get(threadId);
      if (!tab) return current;
      const workTabsByThread = new Map(current.workTabsByThread);
      workTabsByThread.delete(threadId);
      workTabsByThread.set(threadId, tab);
      return { workTabsByThread };
    }),
    workTabFor: (threadId) => get().workTabsByThread.get(threadId) ?? "work",
    reconcileRoster: (threadIds) => set((current) => {
      const roster = new Set(threadIds);
      const selectedThreadIds = new Set([...current.selectedThreadIds].filter((id) => roster.has(id)));
      const selectionAnchorId = current.selectionAnchorId && roster.has(current.selectionAnchorId) ? current.selectionAnchorId : null;
      const expandedThreadIds = new Set([...current.expandedThreadIds].filter((id) => roster.has(id)));
      const workTabsByThread = cappedWorkTabs([...current.workTabsByThread].filter(([id]) => roster.has(id)));
      const dragThreadId = current.dragThreadId && roster.has(current.dragThreadId) ? current.dragThreadId : null;
      const dropTarget = current.dropTarget && roster.has(current.dropTarget.threadId) ? current.dropTarget : null;
      return { selectedThreadIds, selectionAnchorId, expandedThreadIds, workTabsByThread, dragThreadId, dropTarget };
    }),
    reconcileLeftSidebarRoster: (taskIds, pullRequestIds) => set((current) => {
      const taskRoster = new Set(taskIds);
      const pullRequestRoster = new Set(pullRequestIds);
      const selectedTaskIds = new Set(
        [...current.selectedTaskIds].filter((id) => taskRoster.has(id)),
      );
      const taskSelectionAnchorId = current.taskSelectionAnchorId
        && taskRoster.has(current.taskSelectionAnchorId)
        ? current.taskSelectionAnchorId
        : null;
      const selectedPullRequestIds = new Set(
        [...current.selectedPullRequestIds].filter((id) => pullRequestRoster.has(id)),
      );
      const pullRequestSelectionAnchorId = current.pullRequestSelectionAnchorId
        && pullRequestRoster.has(current.pullRequestSelectionAnchorId)
        ? current.pullRequestSelectionAnchorId
        : null;
      const dragTaskId = current.dragTaskId && taskRoster.has(current.dragTaskId)
        ? current.dragTaskId
        : null;
      const taskDropTarget = current.taskDropTarget
        && taskRoster.has(current.taskDropTarget.taskId)
        ? current.taskDropTarget
        : null;
      return {
        selectedTaskIds,
        taskSelectionAnchorId,
        selectedPullRequestIds,
        pullRequestSelectionAnchorId,
        dragTaskId,
        taskDropTarget,
      };
    }),
  }));
}

// One store per frontend bundle generation/window; no persistence middleware.
export const threadInteractionStore = createThreadInteractionStore();
