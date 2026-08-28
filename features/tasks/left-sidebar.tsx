import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { useStore } from "zustand";
import { useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Combobox } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/ui/icon";
import { RefreshButton } from "@/components/ui/refresh-button";
import {
  SidebarListActions,
  SidebarListIconButton,
} from "@/components/ui/sidebar-list-actions";
import type { ThreadProvider } from "../../components/threads/thread-provider-logo";
import { TaskRow } from "./task-row";
import type { rpcContract } from "../../contracts";
import {
  orderTaskLinksByRelevance,
  projectTaskQueue,
  taskMatchesSearch,
  taskReorderNeighbors,
  type SidebarTask,
  type ThreadTaskLink,
} from "../../work-model";
import { tasksSidebarStore } from "./store";
import { useTasksMutations } from "./mutations";
import { useTasksRead, useTasksRealtimeInvalidation } from "./queries";

const EMPTY_TASKS: SidebarTask[] = [];

export interface TasksLeftSidebarProps {
  active: boolean;
  activeThreadId: string | null;
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  ownerThreads: ReadonlyMap<
    string,
    { title: string; providerId: string; provider?: ThreadProvider }
  >;
  onOpenThread: (threadId: string, split?: boolean) => void;
  searchQuery: string;
}

/** The Tasks slice owns task queries, mutations, selection, drag state, and composer UI. */
export function TasksLeftSidebar({
  active,
  activeThreadId,
  taskLinks,
  ownerThreads,
  onOpenThread,
  searchQuery,
}: TasksLeftSidebarProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { data, isPending, isError, error, refetch } = useTasksRead();
  useTasksRealtimeInvalidation();
  const mutations = useTasksMutations(rpc);
  const tasks = data?.tasks ?? EMPTY_TASKS;
  const projects = data?.projects ?? [];
  const [composerOpen, setComposerOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [projectId, setProjectId] = useState("");
  const selectedIds = useStore(tasksSidebarStore, (state) => state.selectedIds);
  const anchorId = useStore(
    tasksSidebarStore,
    (state) => state.selectionAnchorId,
  );
  const dragTaskId = useStore(tasksSidebarStore, (state) => state.dragTaskId);
  const dropTarget = useStore(tasksSidebarStore, (state) => state.dropTarget);

  useEffect(() => {
    tasksSidebarStore.getState().reconcileRoster(tasks.map((task) => task.id));
  }, [tasks]);
  useEffect(() => {
    if (data)
      setProjectId((current) =>
        current && data.projects.some((project) => project.id === current)
          ? current
          : (data.projects[0]?.id ?? ""),
      );
  }, [data]);

  const filtered = useMemo(
    () => tasks.filter((task) => taskMatchesSearch(task, searchQuery)),
    [searchQuery, tasks],
  );
  const queue = useMemo(() => projectTaskQueue(filtered), [filtered]);
  const keys = useMemo(() => {
    const counts = new Map<string, number>();
    for (const task of filtered)
      counts.set(task.key, (counts.get(task.key) ?? 0) + 1);
    return counts;
  }, [filtered]);
  const bindingLinks = useMemo(
    () =>
      new Map(
        (activeThreadId ? taskLinks[activeThreadId] ?? [] : []).map((link) => [
          link.task.id,
          link,
        ]),
      ),
    [activeThreadId, taskLinks],
  );
  const bindingOwnerLinks = useMemo(
    () =>
      new Map(
        Object.values(taskLinks).flatMap((links) =>
          links.map((link) => [link.task.id, link] as const),
        ),
      ),
    [taskLinks],
  );
  const visibleIds = useMemo(
    () =>
      queue.flatMap((node) => [
        node.task.id,
        ...node.children.map((child) => child.id),
      ]),
    [queue],
  );
  const refresh = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const create = useCallback(async () => {
    const nextTitle = title.trim();
    if (!nextTitle || !projectId || mutations.create.isPending) return;
    try {
      await mutations.create.mutateAsync({
        projectId,
        title: nextTitle,
        assignee: "human",
      });
      setTitle("");
      setComposerOpen(false);
    } catch (cause) {
      toast.error(
        cause instanceof Error ? cause.message : "Could not create task",
      );
    }
  }, [mutations.create, projectId, title]);
  const updateStatus = useCallback(
    async (taskId: string, status: SidebarTask["status"]) => {
      try {
        await mutations.status.mutateAsync({ taskId, status });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Could not update task",
        );
      }
    },
    [mutations.status],
  );
  const updateAttachment = useCallback(
    async (taskId: string, threadId: string, attached: boolean) => {
      try {
        await mutations.attachment.mutateAsync({ taskId, threadId, attached });
      } catch (cause) {
        toast.error(
          cause instanceof Error
            ? cause.message
            : `Could not ${attached ? "attach" : "detach"} task`,
        );
      }
    },
    [mutations.attachment],
  );
  const remove = useCallback(
    async (task: SidebarTask) => {
      if (
        !window.confirm(
          `Delete ${task.key}: ${task.title}? This cannot be undone.`,
        )
      )
        return;
      try {
        await mutations.remove.mutateAsync({ taskId: task.id });
        const state = tasksSidebarStore.getState();
        state.setSelected(
          state.selectionAnchorId === task.id ? null : state.selectionAnchorId,
          [...state.selectedIds].filter((id) => id !== task.id),
        );
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Could not delete task",
        );
      }
    },
    [mutations.remove],
  );
  const reorder = useCallback(
    async (
      sourceId: string,
      targetId: string,
      placement: "before" | "after",
    ) => {
      if (searchQuery.trim()) return;
      const neighbors = taskReorderNeighbors(
        tasks,
        sourceId,
        targetId,
        placement,
      );
      if (!neighbors) return;
      tasksSidebarStore.getState().setDrag(null, null);
      try {
        await mutations.reorder.mutateAsync({ taskId: sourceId, ...neighbors });
      } catch (cause) {
        toast.error(
          cause instanceof Error ? cause.message : "Could not save task order",
        );
      }
    },
    [mutations.reorder, searchQuery, tasks],
  );
  const move = useCallback(
    (taskId: string, direction: -1 | 1) => {
      const task = tasks.find((candidate) => candidate.id === taskId);
      if (!task) return;
      const peers = tasks
        .filter(
          (candidate) =>
            candidate.projectId === task.projectId &&
            candidate.status === task.status &&
            candidate.parentTaskId === task.parentTaskId,
        )
        .sort(
          (left, right) =>
            (left.position ?? Number.MAX_SAFE_INTEGER) -
            (right.position ?? Number.MAX_SAFE_INTEGER),
        );
      const target =
        peers[
          peers.findIndex((candidate) => candidate.id === taskId) + direction
        ];
      if (target)
        void reorder(taskId, target.id, direction < 0 ? "before" : "after");
    },
    [reorder, tasks],
  );
  const select = useCallback(
    (taskId: string, event: ReactMouseEvent<HTMLButtonElement>) => {
      const state = tasksSidebarStore.getState();
      if (event.shiftKey && anchorId) {
        const first = visibleIds.indexOf(anchorId);
        const last = visibleIds.indexOf(taskId);
        state.setSelected(
          first >= 0 && last >= 0 ? anchorId : taskId,
          first >= 0 && last >= 0
            ? visibleIds.slice(Math.min(first, last), Math.max(first, last) + 1)
            : [taskId],
        );
        return;
      }
      if (event.ctrlKey || event.metaKey) {
        const next = new Set(state.selectedIds);
        if (next.has(taskId)) next.delete(taskId);
        else next.add(taskId);
        state.setSelected(taskId, next);
        return;
      }
      state.setSelected(taskId, [taskId]);
    },
    [anchorId, visibleIds],
  );

  if (!active) return null;
  return (
    <>
      <div className="ws-list-toolbar">
        <span>
          {filtered.length} active task{filtered.length === 1 ? "" : "s"}
        </span>
        <SidebarListActions
          context={selectedIds.size > 1 ? (
            <span className="ws-selection-count" role="status">
              {selectedIds.size} selected
            </span>
          ) : undefined}
          create={
            <SidebarListIconButton
              title="Add task"
              aria-label="Add task"
              disabled={!projects.length}
              onClick={() => setComposerOpen((open) => !open)}
            >
              <Icon name="Plus" aria-hidden />
            </SidebarListIconButton>
          }
          refresh={
            <RefreshButton label="Refresh tasks" onRefresh={refresh} />
          }
        />
      </div>
      <div className="ws-view-content">
        {composerOpen && (
          <form
            className="ws-task-composer"
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          >
            <Input
              autoFocus
              value={title}
              placeholder="Task title"
              onChange={(event) => setTitle(event.target.value)}
            />
            <Combobox
              value={projectId}
              options={projects.map((project) => ({
                value: project.id,
                label: project.name,
              }))}
              onChange={setProjectId}
              placeholder="Project"
              ariaLabel="Task project"
            />
            <button
              type="submit"
              disabled={
                !title.trim() || !projectId || mutations.create.isPending
              }
            >
              {mutations.create.isPending ? "Adding…" : "Add"}
            </button>
            <button type="button" onClick={() => setComposerOpen(false)}>
              Cancel
            </button>
          </form>
        )}
        {isPending && (
          <div
            className="ws-empty"
            role="status"
            aria-live="polite"
            aria-busy="true"
          >
            Loading tasks…
          </div>
        )}
        {isError && (
          <div className="ws-callout" role="alert">
            {error.message}
            <button onClick={refresh}>Try again</button>
          </div>
        )}
        {!isPending &&
          !isError &&
          queue.map((node) => (
            <TaskRow
              key={node.task.id}
              node={node}
              siblings={queue}
              showProject={(keys.get(node.task.key) ?? 0) > 1}
              reorderDisabled={Boolean(searchQuery.trim())}
              dragTaskId={dragTaskId}
              dropTarget={dropTarget}
              onDragTaskChange={(taskId) =>
                tasksSidebarStore
                  .getState()
                  .setDrag(taskId, tasksSidebarStore.getState().dropTarget)
              }
              onDragTargetChange={(taskId, placement) =>
                tasksSidebarStore
                  .getState()
                  .setDrag(
                    tasksSidebarStore.getState().dragTaskId,
                    taskId && placement ? { taskId, placement } : null,
                  )
              }
              onDropTask={(sourceId, targetId, placement) =>
                void reorder(sourceId, targetId, placement)
              }
              onMoveTask={move}
              onOpenThread={onOpenThread}
              onUpdateStatus={updateStatus}
              onDelete={remove}
              activeThreadId={activeThreadId}
              bindingLinks={bindingLinks}
              bindingOwnerLinks={bindingOwnerLinks}
              ownerThreads={ownerThreads}
              onAttachToThread={(taskId, threadId) =>
                updateAttachment(taskId, threadId, true)
              }
              onDetachFromThread={(taskId, threadId) =>
                updateAttachment(taskId, threadId, false)
              }
              updatingTaskId={
                mutations.status.isPending
                  ? (mutations.status.variables?.taskId ?? null)
                  : null
              }
              updatingAttachmentTaskId={
                mutations.attachment.isPending
                  ? (mutations.attachment.variables?.taskId ?? null)
                  : null
              }
              selectedTaskIds={selectedIds}
              onSelect={select}
            />
          ))}
        {!isPending && !isError && !filtered.length && (
          <div className="ws-empty">
            {searchQuery
              ? `No tasks match “${searchQuery}”.`
              : "No active tasks."}
          </div>
        )}
      </div>
    </>
  );
}
