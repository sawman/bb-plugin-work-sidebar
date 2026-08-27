import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useStore } from "zustand";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginSidebarThread,
  PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  childrenByParent,
  filterThreadsWithAncestors,
  moveThreadSibling,
  normalizeIndicator,
  reconcileThreadOrder,
  reorderThreadSibling,
  rootThreads,
  threadTitle,
} from "../../work-model";
import { Icon } from "@/components/ui/icon";
import { changesInteractionStore } from "@/features/changes/store";
import { TasksLeftSidebar } from "@/features/tasks/left-sidebar";
import { useTaskLinksRead } from "@/features/tasks/queries";
import { PullRequestsLeftSidebar } from "@/features/pull-requests/left-sidebar";
import "../../app.css";
import "../../scrollbar.css";
import "../../views.css";
import {
  selectThreadIds,
  sidebarViewLabel,
  type SidebarThreadGroup,
  type SidebarView,
} from "./model";
import { threadInteractionStore, type ThreadDropTarget } from "./store";
import {
  threadQueryKeys,
  useThreadPreferences,
  useUnarchiveSidebarThread,
} from "./queries";
import { ArchivedThreads } from "./archived-threads";
import { WorkThreadTree, visibleThreadTreeIds } from "./thread-row";

function EmptyOriginal() {
  return null;
}

export function ThreadsSidebarController(props: PluginThreadListProps) {
  const Original =
    props.Original ?? props.experimental_Original ?? EmptyOriginal;
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const threadPreferences = useThreadPreferences();
  const queryClient = useQueryClient();
  const { data: taskLinksData, refetch: refetchTaskLinks } = useTaskLinksRead();
  const taskLinks = taskLinksData?.links ?? {};
  const unarchiveMutation = useUnarchiveSidebarThread();
  const [archivedThreadIds, setArchivedThreadIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const [view, setView] = useState<SidebarView>("work");
  const threadListMode = threadPreferences.listMode.data ?? "enhanced";
  const [threadSettingsOpen, setThreadSettingsOpen] = useState(false);
  const [activeThreadsOpen, setActiveThreadsOpen] = useState(true);
  const threadOrder = threadPreferences.order.data ?? [];
  const threadGroups = threadPreferences.groups.data ?? [];
  const dragThreadId = useStore(
    threadInteractionStore,
    (state) => state.dragThreadId,
  );
  const threadDropTarget = useStore(
    threadInteractionStore,
    (state) => state.dropTarget,
  );
  const selectedThreadIds = useStore(
    threadInteractionStore,
    (state) => state.selectedThreadIds,
  );
  const setDragThreadId = useCallback((threadId: string | null) => {
    const state = threadInteractionStore.getState();
    state.setDrag(threadId, state.dropTarget);
  }, []);
  const setThreadDropTarget = useCallback((dropTarget: ThreadDropTarget) => {
    const state = threadInteractionStore.getState();
    state.setDrag(state.dragThreadId, dropTarget);
  }, []);
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);

  useEffect(() => {
    const threadIds = threads.map((thread) => thread.id);
    threadInteractionStore.getState().reconcileRoster(threadIds);
    changesInteractionStore.getState().cleanup(threadIds);
  }, [threads]);

  const setSavedThreadListMode = (mode: "enhanced" | "native") => {
    setThreadSettingsOpen(false);
    void threadPreferences.saveListMode
      .mutateAsync(mode)
      .catch(() => toast.error("Could not save thread-list preference."));
  };

  const refreshSidebarOrder = useCallback(async () => {
    await threadPreferences.order.refetch();
  }, [threadPreferences.order]);
  const refreshThreadGroups = useCallback(async () => {
    await threadPreferences.groups.refetch();
  }, [threadPreferences.groups]);
  const saveThreadGroups = useCallback(
    (next: SidebarThreadGroup[], previous = threadGroups) => {
      void threadPreferences.saveGroups
        .mutateAsync(next)
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save thread groups",
          );
        });
    },
    [threadPreferences.saveGroups, threadGroups],
  );
  const unarchiveThread = useCallback(
    (threadId: string, destination: string | null) => {
      void unarchiveMutation
        .mutateAsync(threadId)
        .then(() => {
          if (destination)
            saveThreadGroups(
              threadGroups.map((group) =>
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
    [saveThreadGroups, threadGroups, unarchiveMutation],
  );
  const persistSidebarOrder = useCallback(
    async (next: string[]) => {
      try {
        await threadPreferences.saveOrder.mutateAsync(next);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save sidebar order",
        );
      }
    },
    [threadPreferences.saveOrder],
  );

  const refreshThreadDetails = useCallback(async () => {
    void refreshSidebarOrder();
    void refreshThreadGroups();
    void refetchTaskLinks();
    void queryClient.invalidateQueries({
      queryKey: threadQueryKeys.archived(),
    });
    setSubtextRefreshKey((current) => current + 1);
  }, [queryClient, refetchTaskLinks, refreshThreadGroups, refreshSidebarOrder]);

  const projectNames = useMemo(
    () =>
      Object.fromEntries(projects.map((project) => [project.id, project.name])),
    [projects],
  );
  const effectiveOrder = useMemo(
    () => reconcileThreadOrder(threadOrder, threads),
    [threadOrder, threads],
  );
  const allChildrenByThread = useMemo(
    () => childrenByParent(threads, effectiveOrder),
    [effectiveOrder, threads],
  );
  const threadGroupIds = useMemo(() => {
    const result = new Map<string, string>();
    const includeDescendants = (threadId: string, groupId: string) => {
      if (result.has(threadId)) return;
      result.set(threadId, groupId);
      for (const child of allChildrenByThread.get(threadId) ?? [])
        includeDescendants(child.id, groupId);
    };
    for (const group of threadGroups)
      for (const threadId of group.threadIds)
        includeDescendants(threadId, group.id);
    return result;
  }, [allChildrenByThread, threadGroups]);
  const allGroupedIds = useMemo(
    () => new Set(threadGroupIds.keys()),
    [threadGroupIds],
  );
  const filtered = useMemo(
    () =>
      filterThreadsWithAncestors(
        threads.filter((thread) => !allGroupedIds.has(thread.id)),
        projectNames,
        props.searchQuery,
      ),
    [allGroupedIds, threads, projectNames, props.searchQuery],
  );
  const orderedRoots = useMemo(
    () => rootThreads(filtered, effectiveOrder),
    [effectiveOrder, filtered],
  );
  const childrenByThread = useMemo(
    () => childrenByParent(filtered, effectiveOrder),
    [effectiveOrder, filtered],
  );
  const groupedThreadTrees = useMemo(
    () =>
      new Map(
        threadGroups.map((group) => {
          const groupThreads = threads.filter(
            (thread) => threadGroupIds.get(thread.id) === group.id,
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
    [effectiveOrder, threadGroupIds, threadGroups, threads],
  );
  const projectsById = useMemo(
    () => new Map(projects.map((project) => [project.id, project])),
    [projects],
  );
  const reorderDisabled = props.searchQuery.trim().length > 0;
  const visibleThreadIds = useMemo(
    () => visibleThreadTreeIds(orderedRoots, childrenByThread),
    [childrenByThread, orderedRoots],
  );

  const moveThreadToGroup = useCallback(
    (threadId: string, destination: string | null) => {
      const thread = threads.find((candidate) => candidate.id === threadId);
      if (!thread) return;
      const subtree = new Set(
        visibleThreadTreeIds([thread], allChildrenByThread),
      );
      const next = threadGroups.map((group) => ({
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
      saveThreadGroups(next);
    },
    [allChildrenByThread, saveThreadGroups, threadGroups, threads],
  );
  const addThreadGroup = useCallback(() => {
    if (threadGroups.length >= 12) {
      toast.error("You can have up to 12 custom groups.");
      return;
    }
    const name = window.prompt("Name this thread group");
    if (!name?.trim()) return;
    const trimmed = name.trim().slice(0, 40);
    if (
      threadGroups.some(
        (group) =>
          group.name.localeCompare(trimmed, undefined, {
            sensitivity: "accent",
          }) === 0,
      )
    ) {
      toast.error("A group with that name already exists.");
      return;
    }
    const id = `group_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    saveThreadGroups([...threadGroups, { id, name: trimmed, threadIds: [] }]);
  }, [saveThreadGroups, threadGroups]);
  const renameThreadGroup = useCallback(
    (group: SidebarThreadGroup) => {
      const name = window.prompt("Rename thread group", group.name);
      if (!name?.trim()) return;
      const trimmed = name.trim().slice(0, 40);
      if (
        threadGroups.some(
          (candidate) =>
            candidate.id !== group.id &&
            candidate.name.localeCompare(trimmed, undefined, {
              sensitivity: "accent",
            }) === 0,
        )
      ) {
        toast.error("A group with that name already exists.");
        return;
      }
      saveThreadGroups(
        threadGroups.map((candidate) =>
          candidate.id === group.id
            ? { ...candidate, name: trimmed }
            : candidate,
        ),
      );
    },
    [saveThreadGroups, threadGroups],
  );
  const removeThreadGroup = useCallback(
    (group: SidebarThreadGroup) => {
      if ([...threadGroupIds.values()].includes(group.id)) return;
      saveThreadGroups(
        threadGroups.filter((candidate) => candidate.id !== group.id),
      );
    },
    [saveThreadGroups, threadGroupIds, threadGroups],
  );

  // Plain click retains BB's normal open behavior. Ctrl/Cmd toggles an item,
  // while Shift extends a range through the currently visible work list.
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
  const selectedArchiveRoots = useMemo(() => {
    const byId = new Map(threads.map((thread) => [thread.id, thread]));
    return [...selectedThreadIds].filter((id) => {
      for (
        let parent = byId.get(id)?.parentThreadId;
        parent;
        parent = byId.get(parent)?.parentThreadId
      ) {
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

  const reorder = (
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ) => {
    if (reorderDisabled) return;
    const next = reorderThreadSibling(
      effectiveOrder,
      threads,
      sourceId,
      targetId,
      placement,
    );
    if (next.some((id, index) => id !== effectiveOrder[index]))
      void persistSidebarOrder(next);
  };
  const move = (threadId: string, direction: -1 | 1) => {
    if (reorderDisabled) return;
    const next = moveThreadSibling(
      effectiveOrder,
      threads,
      threadId,
      direction,
    );
    if (next.some((id, index) => id !== effectiveOrder[index]))
      void persistSidebarOrder(next);
  };

  if (status !== "ready") return <Original />;

  const activeSidebarThread = props.activeThreadId
    ? (threads.find((thread) => thread.id === props.activeThreadId) ?? null)
    : null;
  const navigateToThread = (threadId: string, split = false) => {
    actions.open(threadId, { split });
    props.onNavigate();
  };
  const viewToolbar = (
    <>
      <span>
        {threadListMode === "native"
          ? "Threads"
          : `${filtered.length} thread${filtered.length === 1 ? "" : "s"}`}
      </span>
      <span className="ws-work-toolbar-actions">
        {threadListMode === "enhanced" && (
          <>
            {selectedThreadIds.size > 1 && (
              <>
                <span className="ws-selection-count" role="status">
                  {selectedThreadIds.size} selected
                </span>
                <button
                  className="ws-selection-archive"
                  onClick={() => void archiveSelected()}
                >
                  Archive selected
                </button>
              </>
            )}
            {reorderDisabled && (
              <span className="ws-reorder-disabled" role="status">
                Clear search to reorder
              </span>
            )}
          </>
        )}
        <span className="ws-thread-settings">
          <button
            className="ws-icon-button"
            title="Thread list settings"
            aria-label="Thread list settings"
            aria-expanded={threadSettingsOpen}
            onClick={() => setThreadSettingsOpen((open) => !open)}
          >
            <Icon name="Wrench" aria-hidden />
          </button>
          {threadSettingsOpen && (
            <span className="ws-thread-settings-menu" role="menu">
              <button
                role="menuitemradio"
                aria-checked={threadListMode === "enhanced"}
                onClick={() => setSavedThreadListMode("enhanced")}
              >
                Enhanced list
              </button>
              <button
                role="menuitemradio"
                aria-checked={threadListMode === "native"}
                onClick={() => setSavedThreadListMode("native")}
              >
                BB native list
              </button>
              <span className="ws-thread-group-settings">
                <b>Custom groups</b>
                {threadGroups.map((group) => (
                  <span key={group.id}>
                    <button
                      title={`Rename ${group.name}`}
                      onClick={() => renameThreadGroup(group)}
                    >
                      {group.name}
                    </button>
                    <button
                      className="ws-thread-group-remove"
                      title={
                        [...threadGroupIds.values()].includes(group.id)
                          ? "Move its threads before removing"
                          : `Remove ${group.name}`
                      }
                      aria-label={`Remove ${group.name}`}
                      disabled={[...threadGroupIds.values()].includes(group.id)}
                      onClick={() => removeThreadGroup(group)}
                    >
                      <Icon name="X" aria-hidden />
                    </button>
                  </span>
                ))}
                <button
                  className="ws-thread-group-add"
                  onClick={addThreadGroup}
                >
                  Add group
                </button>
              </span>
            </span>
          )}
        </span>
        <button
          className="ws-icon-button"
          title="Refresh threads"
          aria-label="Refresh threads"
          onClick={() => void refreshThreadDetails()}
        >
          <Icon name="RefreshCw" aria-hidden />
        </button>
        {props.activeProjectId && (
          <Button
            className="ws-new-thread"
            variant="ghost"
            size="icon"
            title="New thread in project"
            aria-label="New thread in project"
            onClick={() =>
              actions.openNewThread({
                projectId: props.activeProjectId!,
                focusPrompt: true,
              })
            }
          >
            <Icon name="Plus" aria-hidden />
          </Button>
        )}
      </span>
    </>
  );

  return (
    <div className="ws-list">
      <nav className="ws-view-selector" aria-label="Sidebar views">
        {(["work", "queue", "prs"] as const).map((id) => (
          <button
            key={id}
            className={view === id ? "ws-view-active" : ""}
            aria-pressed={view === id}
            onClick={() => setView(id)}
          >
            {sidebarViewLabel(id)}
          </button>
        ))}
      </nav>
      <TasksLeftSidebar
        active={view === "queue"}
        activeThreadId={props.activeThreadId}
        activeThreadTitle={
          activeSidebarThread ? threadTitle(activeSidebarThread) : null
        }
        onOpenThread={navigateToThread}
        searchQuery={props.searchQuery}
      />
      <PullRequestsLeftSidebar
        active={view === "prs"}
        searchQuery={props.searchQuery}
      />
      {view === "work" && (
        <>
          <div className="ws-list-toolbar">{viewToolbar}</div>
          {threadListMode === "native" ? (
            <section
              className="ws-native-thread-list"
              aria-label="BB native threads"
            >
              <Original />
            </section>
          ) : (
            <>
              <section
                className="ws-thread-statuses"
                aria-label="Thread status groups"
              >
                <details
                  className="ws-later ws-active-threads"
                  data-ws-thread-drop-zone="active"
                  data-drop-target={
                    threadDropTarget?.threadId === "active" || undefined
                  }
                  open={activeThreadsOpen}
                  onToggle={(event) =>
                    setActiveThreadsOpen(event.currentTarget.open)
                  }
                  onDragOver={(event) => {
                    const sourceId =
                      dragThreadId ?? event.dataTransfer.getData("text/plain");
                    if (
                      !sourceId ||
                      (!threadGroupIds.has(sourceId) &&
                        !archivedThreadIds.has(sourceId))
                    )
                      return;
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                    setThreadDropTarget({
                      threadId: "active",
                      placement: "after",
                    });
                  }}
                  onDrop={(event) => {
                    const sourceId =
                      dragThreadId ?? event.dataTransfer.getData("text/plain");
                    if (
                      !sourceId ||
                      (!threadGroupIds.has(sourceId) &&
                        !archivedThreadIds.has(sourceId))
                    )
                      return;
                    event.preventDefault();
                    if (archivedThreadIds.has(sourceId))
                      unarchiveThread(sourceId, null);
                    else moveThreadToGroup(sourceId, null);
                    setDragThreadId(null);
                    setThreadDropTarget(null);
                  }}
                >
                  <summary>
                    Active <span>{orderedRoots.length}</span>
                  </summary>
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
                {threadGroups.map((group) => {
                  const tree = groupedThreadTrees.get(group.id);
                  const roots = tree?.roots ?? [];
                  return (
                    <details
                      key={group.id}
                      className="ws-later"
                      data-ws-thread-drop-zone={group.id}
                      data-drop-target={
                        threadDropTarget?.threadId === group.id || undefined
                      }
                      open
                      onDragOver={(event) => {
                        const sourceId =
                          dragThreadId ??
                          event.dataTransfer.getData("text/plain");
                        if (
                          !sourceId ||
                          threadGroupIds.get(sourceId) === group.id
                        )
                          return;
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                        setThreadDropTarget({
                          threadId: group.id,
                          placement: "after",
                        });
                      }}
                      onDrop={(event) => {
                        const sourceId =
                          dragThreadId ??
                          event.dataTransfer.getData("text/plain");
                        if (
                          !sourceId ||
                          threadGroupIds.get(sourceId) === group.id
                        )
                          return;
                        event.preventDefault();
                        if (archivedThreadIds.has(sourceId))
                          unarchiveThread(sourceId, group.id);
                        else moveThreadToGroup(sourceId, group.id);
                        setDragThreadId(null);
                        setThreadDropTarget(null);
                      }}
                    >
                      <summary>
                        {group.name} <span>{roots.length}</span>
                      </summary>
                      {roots.length > 0 ? (
                        <section
                          className="ws-hierarchy"
                          aria-label={`${group.name} threads`}
                        >
                          {roots.map((thread) => (
                            <WorkThreadTree
                              key={thread.id}
                              thread={thread}
                              childrenByThread={tree?.children ?? new Map()}
                              taskLinks={taskLinks}
                              activeThreadId={props.activeThreadId}
                              selectedThreadIds={selectedThreadIds}
                              groupIds={threadGroupIds}
                              groups={threadGroups}
                              projectsById={projectsById}
                              onNavigate={props.onNavigate}
                              onSelect={selectThread}
                              onMoveToGroup={moveThreadToGroup}
                              orderedSiblings={roots}
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
                      ) : (
                        <div className="ws-later-empty">
                          Right-click a thread to move it here.
                        </div>
                      )}
                    </details>
                  );
                })}
                <ArchivedThreads
                  threads={threads}
                  projectsById={projectsById}
                  groups={threadGroups}
                  onSaveGroups={saveThreadGroups}
                  onNavigate={props.onNavigate}
                  dragThreadId={dragThreadId}
                  onDragThreadChange={setDragThreadId}
                  dropTarget={threadDropTarget}
                  onDropTargetChange={setThreadDropTarget}
                  onArchive={(threadId) => {
                    if (threadGroupIds.has(threadId))
                      moveThreadToGroup(threadId, null);
                    actions.archive(threadId);
                  }}
                  onRoster={setArchivedThreadIds}
                />
              </section>
              {filtered.length === 0 && (
                <div className="ws-empty">
                  {props.searchQuery
                    ? `No threads match “${props.searchQuery}”.`
                    : "No active threads."}
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
