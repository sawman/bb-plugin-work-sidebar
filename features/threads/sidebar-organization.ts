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
  reconcileThreadOrder,
  reorderThreadSibling,
  rootThreads,
} from "../../work-model";
import {
  moveThreadGroup,
  reorderThreadGroup,
  selectThreadIds,
  threadGroupPositions,
  type SidebarThreadGroup,
  type SidebarThreadGroupPosition,
} from "./model";
import { threadInteractionStore, type ThreadDropTarget } from "./store";
import { visibleThreadTreeIds } from "./thread-tree-model";

type ThreadProject = { id: string; name: string; isPersonal: boolean };
type ThreadTree = {
  roots: PluginSidebarThread[];
  children: Map<string, PluginSidebarThread[]>;
};
type ThreadPartitions = {
  active: readonly PluginSidebarThread[];
  grouped: ReadonlyMap<string, readonly PluginSidebarThread[]>;
};

type SidebarOrganizationInput = {
  active: boolean;
  threads: readonly PluginSidebarThread[];
  hierarchyThreads?: readonly PluginSidebarThread[];
  projects: readonly ThreadProject[];
  order: readonly string[];
  groups: readonly SidebarThreadGroup[];
  activeGroupPosition: number;
  searchQuery: string;
  saveGroups(groups: SidebarThreadGroup[], activeGroupPosition?: number): void | Promise<void>;
  saveOrder(order: string[]): void;
  bin?(threadId: string, originGroupId: string | null): Promise<unknown>;
  restore?(
    threadId: string,
    groupIds: string[],
  ): Promise<{ destination: string | null }>;
};

export type SidebarThreadOrganization = {
  threads: readonly PluginSidebarThread[];
  groups: readonly SidebarThreadGroup[];
  groupPositions: readonly SidebarThreadGroupPosition[];
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
  moveToGroup(threadId: string, destination: string | null): void | Promise<void>;
  moveToRecycleBin(threadId: string): Promise<void>;
  restoreFromRecycleBin(threadId: string): void;
  reorder(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
  binSelected(): Promise<void>;
  saveGroups(groups: SidebarThreadGroup[]): void | Promise<void>;
  addGroup(name: string): boolean;
  moveGroup(groupId: string, direction: -1 | 1): void;
  reorderGroup(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
  renameGroup(group: SidebarThreadGroup, name: string): boolean;
  removeGroup(group: SidebarThreadGroup): void;
};

const EMPTY_THREADS: readonly PluginSidebarThread[] = [];
const EMPTY_GROUPS: readonly SidebarThreadGroup[] = [];
const EMPTY_GROUP_POSITIONS: readonly SidebarThreadGroupPosition[] = [];
const EMPTY_ORDER: readonly string[] = [];
const EMPTY_THREAD_TREE = new Map<string, PluginSidebarThread[]>();
const EMPTY_GROUP_TREES = new Map<string, ThreadTree>();
const EMPTY_GROUP_IDS = new Map<string, string>();
const EMPTY_PROJECTS = new Map<string, ThreadProject>();
const EMPTY_PROJECT_NAMES: Readonly<Record<string, string>> = {};
const EMPTY_SELECTION = new Set<string>();
const EMPTY_GROUP_ID_SET = new Set<string>();
const EMPTY_THREAD_PARTITIONS: ThreadPartitions = {
  active: EMPTY_THREADS,
  grouped: new Map(),
};

export function useSidebarThreadOrganization({
  active,
  threads,
  hierarchyThreads = threads,
  projects,
  order,
  groups,
  activeGroupPosition,
  searchQuery,
  saveGroups,
  saveOrder,
  bin,
  restore,
}: SidebarOrganizationInput): SidebarThreadOrganization {
  const dragThreadId = useStore(threadInteractionStore, (state) =>
    active ? state.dragThreadId : null,
  );
  const dropTarget = useStore(threadInteractionStore, (state) =>
    active ? state.dropTarget : null,
  );
  const selectedThreadIds = useStore(threadInteractionStore, (state) =>
    active ? state.selectedThreadIds : EMPTY_SELECTION,
  );
  const effectiveOrder = useMemo(
    () => (active ? reconcileThreadOrder(order, threads) : EMPTY_ORDER),
    [active, order, threads],
  );
  const allChildren = useMemo(
    () =>
      active
        ? childrenByParent(hierarchyThreads, effectiveOrder)
        : EMPTY_THREAD_TREE,
    [active, effectiveOrder, hierarchyThreads],
  );
  const projectsById = useMemo(
    () =>
      active
        ? new Map(projects.map((project) => [project.id, project]))
        : EMPTY_PROJECTS,
    [active, projects],
  );
  const projectNames = useMemo(
    () =>
      active
        ? Object.fromEntries(
            projects.map((project) => [project.id, project.name]),
          )
        : EMPTY_PROJECT_NAMES,
    [active, projects],
  );
  const groupIds = useMemo(() => {
    if (!active) return EMPTY_GROUP_IDS;
    const result = new Map<string, string>();
    // Stored group preferences can outlive an archived or deleted host thread.
    // Only extant non-archived hierarchy records may keep a group occupied.
    const knownThreadIds = new Set(hierarchyThreads.map((thread) => thread.id));
    const includeDescendants = (threadId: string, groupId: string) => {
      if (!knownThreadIds.has(threadId) || result.has(threadId)) return;
      result.set(threadId, groupId);
      for (const child of allChildren.get(threadId) ?? [])
        includeDescendants(child.id, groupId);
    };
    for (const group of groups)
      for (const threadId of group.threadIds)
        includeDescendants(threadId, group.id);
    return result;
  }, [active, allChildren, groups, hierarchyThreads]);
  const threadPartitions = useMemo(() => {
    if (!active) return EMPTY_THREAD_PARTITIONS;
    const activeThreads: PluginSidebarThread[] = [];
    const grouped = new Map<string, PluginSidebarThread[]>();
    for (const thread of threads) {
      const groupId = groupIds.get(thread.id);
      if (!groupId) {
        activeThreads.push(thread);
        continue;
      }
      const groupThreads = grouped.get(groupId) ?? [];
      groupThreads.push(thread);
      grouped.set(groupId, groupThreads);
    }
    return { active: activeThreads, grouped };
  }, [active, groupIds, threads]);
  const filtered = useMemo(
    () =>
      active
        ? filterThreadsWithAncestors(
            threadPartitions.active,
            projectNames,
            searchQuery,
          )
        : EMPTY_THREADS,
    [active, projectNames, searchQuery, threadPartitions.active],
  );
  const activeRoots = useMemo(
    () => (active ? rootThreads(filtered, effectiveOrder) : EMPTY_THREADS),
    [active, effectiveOrder, filtered],
  );
  const activeChildren = useMemo(
    () =>
      active ? childrenByParent(filtered, effectiveOrder) : EMPTY_THREAD_TREE,
    [active, effectiveOrder, filtered],
  );
  const groupedTrees = useMemo(
    () =>
      active
        ? new Map(
            groups.map((group) => {
              const groupThreads = filterThreadsWithAncestors(
                threadPartitions.grouped.get(group.id) ?? EMPTY_THREADS,
                projectNames,
                searchQuery,
              );
              return [
                group.id,
                {
                  roots: rootThreads(groupThreads, effectiveOrder),
                  children: childrenByParent(groupThreads, effectiveOrder),
                },
              ] as const;
            }),
          )
        : EMPTY_GROUP_TREES,
    [
      active,
      effectiveOrder,
      groupIds,
      groups,
      projectNames,
      searchQuery,
      threadPartitions.grouped,
    ],
  );
  const groupPositions = useMemo(
    () =>
      active
        ? threadGroupPositions(groups, activeGroupPosition)
        : EMPTY_GROUP_POSITIONS,
    [active, activeGroupPosition, groups],
  );
  const visibleThreadIds = useMemo(
    () =>
      active ? visibleThreadTreeIds(activeRoots, activeChildren) : EMPTY_ORDER,
    [active, activeChildren, activeRoots],
  );
  const reorderDisabled = !active || searchQuery.trim().length > 0;
  const occupiedGroupIds = useMemo(
    () => (active ? new Set(groupIds.values()) : EMPTY_GROUP_ID_SET),
    [active, groupIds],
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
    async (threadId: string, destination: string | null) => {
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
      await saveGroups(next);
    },
    [allChildren, groups, saveGroups, threads],
  );
  const moveToRecycleBin = useCallback(
    async (threadId: string) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      const subtree = visibleThreadTreeIds([thread], allChildren);
      try {
        for (const id of subtree)
          await (bin?.(id, groupIds.get(id) ?? null) ?? Promise.resolve());
        toast.success("Moved to Recycle Bin");
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not move thread to Recycle Bin",
        );
      }
    },
    [allChildren, bin, groupIds, threads],
  );
  const restoreFromRecycleBin = useCallback(
    (threadId: string) => {
      const thread = hierarchyThreads.find((candidate) => candidate.id === threadId);
      const descendants = thread
        ? visibleThreadTreeIds([thread], allChildren)
        : [threadId];
      void (async () => {
        if (!restore) throw new Error("Recycle Bin is unavailable");
        let destination: string | null = null;
        for (const id of descendants) {
          const result = await restore(id, groups.map((group) => group.id));
          if (id === threadId) destination = result.destination;
        }
        toast.success(
          destination
            ? `Restored to ${groups.find((group) => group.id === destination)?.name ?? "previous group"}`
            : "Restored to Active",
        );
      })().catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Could not restore thread",
        ),
      );
    },
    [allChildren, groups, hierarchyThreads, restore],
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
  const binSelected = useCallback(async () => {
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
    for (const id of roots) await moveToRecycleBin(id);
    threadInteractionStore.getState().setSelected(null, []);
  }, [moveToRecycleBin, selectedThreadIds, threads]);
  const addGroup = useCallback(
    (input: string) => {
      if (groups.length >= 12) {
        toast.error("You can have up to 12 custom groups.");
        return false;
      }
      const name = input.trim().slice(0, 40);
      if (!name) return false;
      if (
        groups.some(
          (group) =>
            group.name.localeCompare(name, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      ) {
        toast.error("A group with that name already exists.");
        return false;
      }
      const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      void Promise.resolve(saveGroups([...groups, { id, name, threadIds: [] }])).catch(() => undefined);
      return true;
    },
    [groups, saveGroups],
  );
  const renameGroup = useCallback(
    (group: SidebarThreadGroup, input: string) => {
      const name = input.trim().slice(0, 40);
      if (!name) return false;
      if (
        groups.some(
          (candidate) =>
            candidate.id !== group.id &&
            candidate.name.localeCompare(name, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      ) {
        toast.error("A group with that name already exists.");
        return false;
      }
      void Promise.resolve(saveGroups(
        groups.map((candidate) =>
          candidate.id === group.id ? { ...candidate, name } : candidate,
        ),
      )).catch(() => undefined);
      return true;
    },
    [groups, saveGroups],
  );
  const moveGroup = useCallback(
    (groupId: string, direction: -1 | 1) => {
      const next = moveThreadGroup(
        groups,
        activeGroupPosition,
        groupId,
        direction,
      );
      if (next) void Promise.resolve(saveGroups(next.groups, next.activeGroupPosition)).catch(() => undefined);
    },
    [activeGroupPosition, groups, saveGroups],
  );
  const reorderGroup = useCallback(
    (sourceId: string, targetId: string, placement: "before" | "after") => {
      const next = reorderThreadGroup(
        groups,
        activeGroupPosition,
        sourceId,
        targetId,
        placement,
      );
      if (next) void Promise.resolve(saveGroups(next.groups, next.activeGroupPosition)).catch(() => undefined);
    },
    [activeGroupPosition, groups, saveGroups],
  );
  const removeGroup = useCallback(
    (group: SidebarThreadGroup) => {
      if (occupiedGroupIds.has(group.id)) return;
      const remainingPositions = groupPositions.filter(
        (position) => position.id !== group.id,
      );
      void Promise.resolve(saveGroups(
        groups.filter((candidate) => candidate.id !== group.id),
        remainingPositions.findIndex((position) => !position.group),
      )).catch(() => undefined);
    },
    [groupPositions, groups, occupiedGroupIds, saveGroups],
  );
  return {
    threads: active ? threads : EMPTY_THREADS,
    groups: active ? groups : EMPTY_GROUPS,
    groupPositions,
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
    moveToRecycleBin,
    restoreFromRecycleBin,
    reorder,
    binSelected,
    saveGroups,
    addGroup,
    moveGroup,
    reorderGroup,
    renameGroup,
    removeGroup,
  };
}
