import { useCallback, useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreads,
  experimental_useProviders,
  type PluginThreadListProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { TabSelector } from "@/components/ui/tab-selector";
import { threadTitle } from "@/work-model";
import { TasksLeftSidebar } from "@/features/tasks/left-sidebar";
import { invalidateTaskQueries } from "@/features/tasks/mutations";
import { useTaskLinksRead } from "@/features/tasks/queries";
import { PullRequestsLeftSidebar } from "@/features/pull-requests/left-sidebar";
import { invalidateSidebarPullRequestStacks } from "@/features/pull-requests/queries";
import "../../app.css";
import "../../scrollbar.css";
import "../../views.css";
import {
  sidebarViewLabel,
  threadCountPresentation,
  type SidebarView,
} from "./model";
import {
  threadQueryKeys,
  useThreadPreferences,
  useUnarchiveSidebarThread,
} from "./queries";
import { useSidebarThreadOrganization } from "./sidebar-organization";
import { threadInteractionStore } from "./store";
import { SidebarThreadToolbar } from "./sidebar-toolbar";
import { SidebarWorkView } from "./sidebar-work-view";

const SIDEBAR_TABS: readonly { id: SidebarView; label: string }[] = (
  ["work", "queue", "prs"] as const
).map((id) => ({ id, label: sidebarViewLabel(id) }));

function EmptyOriginal() {
  return null;
}

export function ThreadsSidebarController(props: PluginThreadListProps) {
  const Original =
    props.Original ?? props.experimental_Original ?? EmptyOriginal;
  const { status, threads, projects } = experimental_useSidebarThreads();
  const providerDirectory = experimental_useProviders();
  const actions = experimental_useSidebarThreadActions();
  const queryClient = useQueryClient();
  const threadPreferences = useThreadPreferences();
  // Sole task-links observer, including native mode: Agents and WorkThreadTree share one
  // cache and polling owner rather than creating per-consumer intervals.
  const { data: taskLinksData, refetch: refetchTaskLinks } = useTaskLinksRead();
  const unarchiveMutation = useUnarchiveSidebarThread();
  const providersById = useMemo(
    () =>
      new Map(
        providerDirectory.providers.map((provider) => [provider.id, provider]),
      ),
    [providerDirectory.providers],
  );
  const taskOwnerThreads = useMemo(
    () =>
      new Map(
        threads.map((thread) => [
          thread.id,
          {
            title: threadTitle(thread),
            providerId: thread.providerId,
            provider: providersById.get(thread.providerId),
          },
        ]),
      ),
    [providersById, threads],
  );
  const [view, setView] = useState<SidebarView>("work");
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);
  const threadCount = useMemo(
    () => threadCountPresentation(threads),
    [threads],
  );
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
  }, [threads]);

  const refreshThreadDetails = useCallback(() => {
    void threadPreferences.order.refetch();
    void threadPreferences.groups.refetch();
    void refetchTaskLinks();
    void invalidateSidebarPullRequestStacks(queryClient);
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
  const activateView = useCallback(
    (nextView: SidebarView) => {
      if (nextView === "queue" && view !== "queue")
        void invalidateTaskQueries(queryClient, ["list", "links"]);
      setView(nextView);
    },
    [queryClient, view],
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
      threadCountLabel={threadCount.label}
      selectedCount={organization.selectedThreadIds.size}
      reorderDisabled={organization.reorderDisabled}
      groups={organization.groups}
      occupiedGroupIds={organization.occupiedGroupIds}
      activeProjectId={props.activeProjectId}
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
      <TabSelector
        ariaLabel="Sidebar views"
        idPrefix="ws-sidebar"
        items={SIDEBAR_TABS}
        sticky
        value={view}
        onValueChange={activateView}
      />
      <TasksLeftSidebar
        active={view === "queue"}
        activeThreadId={props.activeThreadId}
        activeThreadTitle={activeThread ? threadTitle(activeThread) : null}
        taskLinks={taskLinks}
        ownerThreads={taskOwnerThreads}
        onOpenThread={navigateToThread}
        searchQuery={props.searchQuery}
      />
      <PullRequestsLeftSidebar
        active={view === "prs"}
        searchQuery={props.searchQuery}
      />
      {view === "work" && (
        <SidebarWorkView
          toolbar={toolbar}
          organization={organization}
          activeThreadId={props.activeThreadId}
          providersById={providersById}
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
