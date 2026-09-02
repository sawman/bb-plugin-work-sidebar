import { createStore } from "zustand/vanilla";

export type WorkTab = "work" | "changes" | "agents";
export type ThreadDropTarget =
  | {
      kind: "reorder";
      threadId: string;
      placement: "before" | "after";
    }
  | {
      kind: "group";
      groupId: string;
    }
  | {
      kind: "reparent";
      parentThreadId: string | null;
    }
  | null;

const MAX_THREAD_VIEW_ENTRIES = 40;

function sameStringSet(left: ReadonlySet<string>, right: ReadonlySet<string>) {
  return left.size === right.size && [...left].every((value) => right.has(value));
}

function sameOrderedMap(
  left: ReadonlyMap<string, WorkTab>,
  right: ReadonlyMap<string, WorkTab>,
) {
  if (left.size !== right.size) return false;
  const leftEntries = left.entries();
  const rightEntries = right.entries();
  for (;;) {
    const leftEntry = leftEntries.next();
    const rightEntry = rightEntries.next();
    if (leftEntry.done || rightEntry.done) return leftEntry.done === rightEntry.done;
    if (
      leftEntry.value[0] !== rightEntry.value[0] ||
      leftEntry.value[1] !== rightEntry.value[1]
    )
      return false;
  }
}

function sameDropTarget(left: ThreadDropTarget, right: ThreadDropTarget) {
  if (left === right) return true;
  if (!left || !right || left.kind !== right.kind) return false;
  return left.kind === "reorder"
    ? right.kind === "reorder" &&
      left.threadId === right.threadId &&
      left.placement === right.placement
    : left.kind === "group"
      ? right.kind === "group" && left.groupId === right.groupId
      : right.kind === "reparent" && left.parentThreadId === right.parentThreadId;
}

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
    // Pointer drag-over can run every frame. Do not turn a stable hover target
    // into a fresh store update that rerenders and re-reconciles the sidebar.
    setDrag: (dragThreadId, dropTarget) =>
      set((current) =>
        current.dragThreadId === dragThreadId &&
        sameDropTarget(current.dropTarget, dropTarget)
          ? current
          : { dragThreadId, dropTarget },
      ),
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
        const dropTarget = current.dropTarget?.kind === "reparent"
          ? !current.dropTarget.parentThreadId || roster.has(current.dropTarget.parentThreadId)
            ? current.dropTarget
            : null
          : current.dropTarget?.kind === "reorder"
            ? roster.has(current.dropTarget.threadId)
              ? current.dropTarget
              : null
            : current.dropTarget?.kind === "group" && dragThreadId
              ? current.dropTarget
              : null;
        if (
          sameStringSet(current.selectedThreadIds, selectedThreadIds) &&
          current.selectionAnchorId === selectionAnchorId &&
          sameStringSet(current.expandedThreadIds, expandedThreadIds) &&
          sameOrderedMap(current.workTabsByThread, workTabsByThread) &&
          current.dragThreadId === dragThreadId &&
          sameDropTarget(current.dropTarget, dropTarget)
        )
          return current;
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
