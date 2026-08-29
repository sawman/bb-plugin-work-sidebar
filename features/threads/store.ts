import { createStore } from "zustand/vanilla";

export type WorkTab = "work" | "changes" | "agents";
export type ThreadDropTarget =
  | {
      kind: "reorder";
      threadId: string;
      placement: "before" | "after";
    }
  | {
      kind: "reparent";
      parentThreadId: string | null;
    }
  | null;

const MAX_THREAD_VIEW_ENTRIES = 40;

export type ThreadInteractionState = {
  selectedThreadIds: Set<string>;
  selectionAnchorId: string | null;
  expandedThreadIds: Set<string>;
  dragThreadId: string | null;
  dropTarget: ThreadDropTarget;
  workTabsByThread: Map<string, WorkTab>;
  setSelected(anchorId: string | null, ids: Iterable<string>): void;
  toggleChildren(threadId: string): void;
  setDrag(threadId: string | null, target: ThreadDropTarget): void;
  setWorkTab(threadId: string, tab: WorkTab): void;
  touchWorkTab(threadId: string): void;
  workTabFor(threadId: string): WorkTab;
  reconcileRoster(threadIds: Iterable<string>): void;
};

function cappedWorkTabs(
  entries: Iterable<[string, WorkTab]>,
): Map<string, WorkTab> {
  const next = new Map(entries);
  while (next.size > MAX_THREAD_VIEW_ENTRIES)
    next.delete(next.keys().next().value!);
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
    workTabsByThread: new Map(),
    setSelected: (selectionAnchorId, ids) =>
      set({ selectedThreadIds: new Set(ids), selectionAnchorId }),
    toggleChildren: (threadId) =>
      set((current) => {
        const expandedThreadIds = new Set(current.expandedThreadIds);
        if (expandedThreadIds.has(threadId)) expandedThreadIds.delete(threadId);
        else expandedThreadIds.add(threadId);
        return { expandedThreadIds };
      }),
    setDrag: (dragThreadId, dropTarget) => set({ dragThreadId, dropTarget }),
    setWorkTab: (threadId, tab) =>
      set((current) => {
        const workTabsByThread = new Map(current.workTabsByThread);
        workTabsByThread.delete(threadId);
        workTabsByThread.set(threadId, tab);
        return { workTabsByThread: cappedWorkTabs(workTabsByThread) };
      }),
    // Access is intentionally explicit so React renders stay pure. Consumers
    // touch an existing entry in an effect after mount or thread switching.
    touchWorkTab: (threadId) =>
      set((current) => {
        const tab = current.workTabsByThread.get(threadId);
        if (!tab) return current;
        const workTabsByThread = new Map(current.workTabsByThread);
        workTabsByThread.delete(threadId);
        workTabsByThread.set(threadId, tab);
        return { workTabsByThread };
      }),
    workTabFor: (threadId) => get().workTabsByThread.get(threadId) ?? "work",
    reconcileRoster: (threadIds) =>
      set((current) => {
        const roster = new Set(threadIds);
        const selectedThreadIds = new Set(
          [...current.selectedThreadIds].filter((id) => roster.has(id)),
        );
        const selectionAnchorId =
          current.selectionAnchorId && roster.has(current.selectionAnchorId)
            ? current.selectionAnchorId
            : null;
        const expandedThreadIds = new Set(
          [...current.expandedThreadIds].filter((id) => roster.has(id)),
        );
        // The left roster omits archived threads that BB may still have open
        // in the right panel. Keep this presentation state and rely on the
        // bounded LRU instead of pruning by the left surface alone.
        const workTabsByThread = cappedWorkTabs(current.workTabsByThread);
        const dragThreadId =
          current.dragThreadId && roster.has(current.dragThreadId)
            ? current.dragThreadId
            : null;
        const dropTarget =
          current.dropTarget?.kind === "reparent"
            ? !current.dropTarget.parentThreadId ||
              roster.has(current.dropTarget.parentThreadId)
              ? current.dropTarget
              : null
            : current.dropTarget && roster.has(current.dropTarget.threadId)
              ? current.dropTarget
              : null;
        return {
          selectedThreadIds,
          selectionAnchorId,
          expandedThreadIds,
          workTabsByThread,
          dragThreadId,
          dropTarget,
        };
      }),
  }));
}

// One store per frontend bundle generation/window; no persistence middleware.
export const threadInteractionStore = createThreadInteractionStore();
