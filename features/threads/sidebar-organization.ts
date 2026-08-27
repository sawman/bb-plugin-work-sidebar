import {
  useCallback,
  useMemo,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useStore } from "zustand";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  childrenByParent,
  filterThreadsWithAncestors,
  moveThreadSibling,
  reconcileThreadOrder,
  reorderThreadSibling,
  rootThreads,
} from "../../work-model";
import { selectThreadIds, type SidebarThreadGroup } from "./model";
import { threadInteractionStore, type ThreadDropTarget } from "./store";
import { visibleThreadTreeIds } from "./thread-row";

type ThreadProject = { id: string; name: string; isPersonal: boolean };
type ThreadTree = {
  roots: PluginSidebarThread[];
  children: Map<string, PluginSidebarThread[]>;
};

type SidebarOrganizationInput = {
  threads: readonly PluginSidebarThread[];
  projects: readonly ThreadProject[];
  order: readonly string[];
  groups: readonly SidebarThreadGroup[];
  searchQuery: string;
  saveGroups(groups: SidebarThreadGroup[]): void;
  saveOrder(order: string[]): void;
  unarchive(threadId: string): Promise<unknown>;
  archive(threadId: string): Promise<unknown>;
};

export type SidebarThreadOrganization = {
  threads: readonly PluginSidebarThread[];
  groups: readonly SidebarThreadGroup[];
  filtered: readonly PluginSidebarThread[];
  activeRoots: readonly PluginSidebarThread[];
  groupedTrees: ReadonlyMap<string, ThreadTree>;
  activeChildren: ReadonlyMap<string, PluginSidebarThread[]>;
  groupIds: ReadonlyMap<string, string>;
  occupiedGroupIds: ReadonlySet<string>;
  projectsById: ReadonlyMap<string, ThreadProject>;
  selectedThreadIds: ReadonlySet<string>;
  dragThreadId: string | null;
  dropTarget: ThreadDropTarget;
  reorderDisabled: boolean;
  selectThread(
    thread: PluginSidebarThread,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): boolean;
  setDragThreadId(threadId: string | null): void;
  setDropTarget(target: ThreadDropTarget): void;
  moveToGroup(threadId: string, destination: string | null): void;
  unarchiveToGroup(threadId: string, destination: string | null): void;
  reorder(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
  move(threadId: string, direction: -1 | 1): void;
  archiveSelected(): Promise<void>;
  archiveThread(threadId: string): void;
  saveGroups(groups: SidebarThreadGroup[]): void;
  addGroup(): void;
  renameGroup(group: SidebarThreadGroup): void;
  removeGroup(group: SidebarThreadGroup): void;
};

export function useSidebarThreadOrganization({
  threads,
  projects,
  order,
  groups,
  searchQuery,
  saveGroups,
  saveOrder,
  unarchive,
  archive,
}: SidebarOrganizationInput): SidebarThreadOrganization {
  const dragThreadId = useStore(
    threadInteractionStore,
    (state) => state.dragThreadId,
  );
  const dropTarget = useStore(
    threadInteractionStore,
    (state) => state.dropTarget,
  );
  const selectedThreadIds = useStore(
    threadInteractionStore,
    (state) => state.selectedThreadIds,
  );
  const effectiveOrder = useMemo(
    () => reconcileThreadOrder(order, threads),
    [order, threads],
  );
  const allChildren = useMemo(
    () => childrenByParent(threads, effectiveOrder),
    [effectiveOrder, threads],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const projectNames = useMemo(
    () =>
      Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const groupIds = useMemo(() => {
    const result = new Map<string, string>();
    const includeDescendants = (threadId: string, groupId: string) => {
      if (result.has(threadId)) return;
      result.set(threadId, groupId);
      for (const child of allChildren.get(threadId) ?? [])
        includeDescendants(child.id, groupId);
    };
    for (const group of groups)
      for (const threadId of group.threadIds)
        includeDescendants(threadId, group.id);
    return result;
  }, [allChildren, groups]);
  const filtered = useMemo(
    () =>
      filterThreadsWithAncestors(
        threads.filter((thread) => !groupIds.has(thread.id)),
        projectNames,
        searchQuery,
      ),
    [groupIds, projectNames, searchQuery, threads],
  );
  const activeRoots = useMemo(
    () => rootThreads(filtered, effectiveOrder),
    [effectiveOrder, filtered],
  );
  const activeChildren = useMemo(
    () => childrenByParent(filtered, effectiveOrder),
    [effectiveOrder, filtered],
  );
  const groupedTrees = useMemo(
    () =>
      new Map(
        groups.map((group) => {
          const groupThreads = threads.filter(
            (thread) => groupIds.get(thread.id) === group.id,
          );
          return [
            group.id,
            {
              roots: rootThreads(groupThreads, effectiveOrder),
              children: childrenByParent(groupThreads, effectiveOrder),
            },
          ] as const;
        }),
      ),
    [effectiveOrder, groupIds, groups, threads],
  );
  const visibleThreadIds = useMemo(
    () => visibleThreadTreeIds(activeRoots, activeChildren),
    [activeChildren, activeRoots],
  );
  const reorderDisabled = searchQuery.trim().length > 0;
  const occupiedGroupIds = useMemo(
    () => new Set(groupIds.values()),
    [groupIds],
  );
  const setDragThreadId = useCallback((threadId: string | null) => {
    const state = threadInteractionStore.getState();
    state.setDrag(threadId, state.dropTarget);
  }, []);
  const setDropTarget = useCallback((target: ThreadDropTarget) => {
    const state = threadInteractionStore.getState();
    state.setDrag(state.dragThreadId, target);
  }, []);
  const moveToGroup = useCallback(
    (threadId: string, destination: string | null) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      const subtree = new Set(visibleThreadTreeIds([thread], allChildren));
      const next = groups.map((group) => ({
        ...group,
        threadIds: group.threadIds.filter((id) => !subtree.has(id)),
      }));
      if (destination) {
        const index = next.findIndex((group) => group.id === destination);
        if (index < 0) return;
        next[index] = {
          ...next[index],
          threadIds: [...new Set([...next[index].threadIds, threadId])],
        };
      }
      saveGroups(next);
    },
    [allChildren, groups, saveGroups, threads],
  );
  const unarchiveToGroup = useCallback(
    (threadId: string, destination: string | null) => {
      void unarchive(threadId)
        .then(() => {
          if (!destination) return;
          saveGroups(
            groups.map((group) =>
              group.id === destination
                ? {
                    ...group,
                    threadIds: [...new Set([...group.threadIds, threadId])],
                  }
                : group,
            ),
          );
        })
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not unarchive thread",
          ),
        );
    },
    [groups, saveGroups, unarchive],
  );
  const selectThread = useCallback(
    (
      thread: PluginSidebarThread,
      event: ReactMouseEvent<HTMLAnchorElement>,
    ) => {
      const state = threadInteractionStore.getState();
      const next = selectThreadIds(
        state.selectedThreadIds,
        state.selectionAnchorId,
        visibleThreadIds,
        thread.id,
        {
          toggle: event.ctrlKey || event.metaKey,
          range: event.shiftKey,
        },
      );
      state.setSelected(next.anchorId, next.selectedIds);
      return next.handled;
    },
    [visibleThreadIds],
  );
  const reorder = useCallback(
    (sourceId: string, targetId: string, placement: "before" | "after") => {
      if (reorderDisabled) return;
      const next = reorderThreadSibling(
        effectiveOrder,
        threads,
        sourceId,
        targetId,
        placement,
      );
      if (next.some((id, index) => id !== effectiveOrder[index]))
        saveOrder(next);
    },
    [effectiveOrder, reorderDisabled, saveOrder, threads],
  );
  const move = useCallback(
    (threadId: string, direction: -1 | 1) => {
      if (reorderDisabled) return;
      const next = moveThreadSibling(
        effectiveOrder,
        threads,
        threadId,
        direction,
      );
      if (next.some((id, index) => id !== effectiveOrder[index]))
        saveOrder(next);
    },
    [effectiveOrder, reorderDisabled, saveOrder, threads],
  );
  const archiveSelected = useCallback(async () => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    const roots = [...selectedThreadIds].filter((id) => {
      for (
        let parent = byId.get(id)?.parentThreadId;
        parent;
        parent = byId.get(parent)?.parentThreadId
      )
        if (selectedThreadIds.has(parent)) return false;
      return byId.has(id);
    });
    await Promise.all(roots.map(archive));
    threadInteractionStore.getState().setSelected(null, []);
  }, [archive, selectedThreadIds, threads]);
  const archiveThread = useCallback(
    (threadId: string) => {
      if (groupIds.has(threadId)) moveToGroup(threadId, null);
      void archive(threadId);
    },
    [archive, groupIds, moveToGroup],
  );
  const addGroup = useCallback(() => {
    if (groups.length >= 12)
      return toast.error("You can have up to 12 custom groups.");
    const name = window.prompt("Name this thread group")?.trim().slice(0, 40);
    if (!name) return;
    if (
      groups.some(
        (group) =>
          group.name.localeCompare(name, undefined, {
            sensitivity: "accent",
          }) === 0,
      )
    )
      return toast.error("A group with that name already exists.");
    const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    saveGroups([...groups, { id, name, threadIds: [] }]);
  }, [groups, saveGroups]);
  const renameGroup = useCallback(
    (group: SidebarThreadGroup) => {
      const name = window
        .prompt("Rename thread group", group.name)
        ?.trim()
        .slice(0, 40);
      if (!name) return;
      if (
        groups.some(
          (candidate) =>
            candidate.id !== group.id &&
            candidate.name.localeCompare(name, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      )
        return toast.error("A group with that name already exists.");
      saveGroups(
        groups.map((candidate) =>
          candidate.id === group.id ? { ...candidate, name } : candidate,
        ),
      );
    },
    [groups, saveGroups],
  );
  const removeGroup = useCallback(
    (group: SidebarThreadGroup) => {
      if (!occupiedGroupIds.has(group.id))
        saveGroups(groups.filter((candidate) => candidate.id !== group.id));
    },
    [groups, occupiedGroupIds, saveGroups],
  );
  return {
    threads,
    groups,
    filtered,
    activeRoots,
    groupedTrees,
    activeChildren,
    groupIds,
    occupiedGroupIds,
    projectsById,
    selectedThreadIds,
    dragThreadId,
    dropTarget,
    reorderDisabled,
    selectThread,
    setDragThreadId,
    setDropTarget,
    moveToGroup,
    unarchiveToGroup,
    reorder,
    move,
    archiveSelected,
    archiveThread,
    saveGroups,
    addGroup,
    renameGroup,
    removeGroup,
  };
}
