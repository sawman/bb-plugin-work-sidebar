import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { threadTitle } from "@/work-model";
import { changesInteractionStore } from "@/features/changes/store";
import { TasksLeftSidebar } from "@/features/tasks/left-sidebar";
import { useTaskLinksRead } from "@/features/tasks/queries";
import { PullRequestsLeftSidebar } from "@/features/pull-requests/left-sidebar";
import "../../app.css";
import "../../scrollbar.css";
import "../../views.css";
import { sidebarViewLabel, type SidebarView } from "./model";
import {
  threadQueryKeys,
  useThreadPreferences,
  useUnarchiveSidebarThread,
} from "./queries";
import { useSidebarThreadOrganization } from "./sidebar-organization";
import { threadInteractionStore } from "./store";
import { SidebarThreadToolbar } from "./sidebar-toolbar";
import { SidebarWorkView } from "./sidebar-work-view";

function EmptyOriginal() {
  return null;
}

export function ThreadsSidebarController(props: PluginThreadListProps) {
  const Original =
    props.Original ?? props.experimental_Original ?? EmptyOriginal;
  const { status, threads, projects } = experimental_useSidebarThreads();
  const actions = experimental_useSidebarThreadActions();
  const queryClient = useQueryClient();
  const threadPreferences = useThreadPreferences();
  // This controller is deliberately the sole global task-links observer.
  // Every live WorkThreadTree receives its one shared query result below.
  const { data: taskLinksData, refetch: refetchTaskLinks } = useTaskLinksRead();
  const unarchiveMutation = useUnarchiveSidebarThread();
  const [view, setView] = useState<SidebarView>("work");
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);
  const threadListMode = threadPreferences.listMode.data ?? "enhanced";
  const saveGroups = useCallback(
    (
      groups: Parameters<typeof threadPreferences.saveGroups.mutateAsync>[0],
    ) => {
      void threadPreferences.saveGroups
        .mutateAsync(groups)
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save thread groups",
          );
        });
    },
    [threadPreferences.saveGroups],
  );
  const saveOrder = useCallback(
    (order: string[]) => {
      void threadPreferences.saveOrder
        .mutateAsync(order)
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save sidebar order",
          );
        });
    },
    [threadPreferences.saveOrder],
  );
  const organization = useSidebarThreadOrganization({
    threads,
    projects,
    order: threadPreferences.order.data ?? [],
    groups: threadPreferences.groups.data ?? [],
    searchQuery: props.searchQuery,
    saveGroups,
    saveOrder,
    unarchive: unarchiveMutation.mutateAsync,
    archive: async (threadId) => actions.archive(threadId),
  });

  useEffect(() => {
    const threadIds = threads.map((thread) => thread.id);
    threadInteractionStore.getState().reconcileRoster(threadIds);
    changesInteractionStore.getState().cleanup(threadIds);
  }, [threads]);

  const refreshThreadDetails = useCallback(() => {
    void threadPreferences.order.refetch();
    void threadPreferences.groups.refetch();
    void refetchTaskLinks();
    void queryClient.invalidateQueries({
      queryKey: threadQueryKeys.archived(),
    });
    setSubtextRefreshKey((current) => current + 1);
  }, [
    queryClient,
    refetchTaskLinks,
    threadPreferences.groups,
    threadPreferences.order,
  ]);
  const saveListMode = useCallback(
    (mode: "enhanced" | "native") => {
      void threadPreferences.saveListMode.mutateAsync(mode).catch(() => {
        toast.error("Could not save thread-list preference.");
      });
    },
    [threadPreferences.saveListMode],
  );
  const navigateToThread = useCallback(
    (threadId: string, split = false) => {
      actions.open(threadId, { split });
      props.onNavigate();
    },
    [actions, props],
  );

  if (status !== "ready") return <Original />;

  const activeThread = props.activeThreadId
    ? (threads.find((thread) => thread.id === props.activeThreadId) ?? null)
    : null;
  const taskLinks = taskLinksData?.links ?? {};
  const toolbar = (
    <SidebarThreadToolbar
      listMode={threadListMode}
      threadCount={organization.filtered.length}
      selectedCount={organization.selectedThreadIds.size}
      reorderDisabled={organization.reorderDisabled}
      groups={organization.groups}
      occupiedGroupIds={organization.occupiedGroupIds}
      activeProjectId={props.activeProjectId}
      onSaveListMode={saveListMode}
      onArchiveSelected={() => void organization.archiveSelected()}
      onAddGroup={organization.addGroup}
      onRenameGroup={organization.renameGroup}
      onRemoveGroup={organization.removeGroup}
      onRefresh={refreshThreadDetails}
      onNewThread={(projectId) =>
        actions.openNewThread({ projectId, focusPrompt: true })
      }
    />
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
        activeThreadTitle={activeThread ? threadTitle(activeThread) : null}
        onOpenThread={navigateToThread}
        searchQuery={props.searchQuery}
      />
      <PullRequestsLeftSidebar
        active={view === "prs"}
        searchQuery={props.searchQuery}
      />
      {view === "work" && (
        <SidebarWorkView
          listMode={threadListMode}
          Original={Original}
          toolbar={toolbar}
          organization={organization}
          taskLinks={taskLinks}
          activeThreadId={props.activeThreadId}
          onNavigate={props.onNavigate}
          subtextRefreshKey={subtextRefreshKey}
          emptyMessage={
            props.searchQuery
              ? `No threads match “${props.searchQuery}”.`
              : "No active threads."
          }
        />
      )}
    </div>
  );
}
