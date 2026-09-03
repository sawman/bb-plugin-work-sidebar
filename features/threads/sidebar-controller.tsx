import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { experimental_useSidebarThreadActions, experimental_useSidebarThreads, experimental_useProviders, type PluginThreadListProps, useSettings } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { TabSelector } from "@/components/ui/tab-selector";
import type { ThreadProvider } from "@/components/threads/thread-provider-logo";
import { threadTitle } from "@/work-model";
import { TasksLeftSidebar } from "@/features/tasks/left-sidebar";
import { invalidateTaskQueries } from "@/features/tasks/mutations";
import { useTaskLinksRead } from "@/features/tasks/queries";
import { PullRequestsLeftSidebar } from "@/features/pull-requests/left-sidebar";
import {
  invalidateSidebarPullRequestStacks,
  invalidateThreadPullRequestDirectory,
} from "@/features/pull-requests/queries";
import { useSidebarThreadPullRequestDirectory } from "@/features/pull-requests/sidebar-directory";
import type { PullRequestThreadReference } from "@/features/pull-requests/thread-link";
import {
  DEFAULT_SIDEBAR_ROW_HEIGHT,
  DEFAULT_TEXT_SCALE,
  DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER,
  DEFAULT_WORKING_PROVIDER_ANIMATION,
} from "./sidebar-appearance";
import { DEFAULT_GROUP_ACTIVITY_PRIORITY } from "./group-activity-priority";
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
  useRecycleBin,
} from "./queries";
import { useSidebarQueuedMessages } from "./queued-messages";
import { useSidebarThreadOrganization } from "./sidebar-organization";
import { threadInteractionStore } from "./store";
import { SidebarThreadToolbar } from "./sidebar-toolbar";
import { SidebarWorkView } from "./sidebar-work-view";
import { ThreadListSettings } from "./sidebar-group-settings";
import { ThreadHierarchyProvider } from "./thread-hierarchy-context";
import { ThreadHierarchyPickerHost } from "./thread-hierarchy-picker-host";
import { TextScaleProvider, textScaleStyle } from "../../shared/text-scale";
import { useGroupDisclosurePreference } from "./use-group-disclosure-preference";
const SIDEBAR_TABS: readonly { id: SidebarView; label: string }[] = (
  ["work", "queue", "prs"] as const
).map((id) => ({ id, label: sidebarViewLabel(id) }));
const EMPTY_TASK_OWNER_THREADS: ReadonlyMap<string, { title: string; providerId: string; provider?: ThreadProvider }> = new Map();
const EMPTY_PULL_REQUEST_THREADS: readonly PullRequestThreadReference[] = [];
function EmptyOriginal() {
  return null;
}

export function ThreadsSidebarController(props: PluginThreadListProps) {
  const Original =
    props.Original ?? props.experimental_Original ?? EmptyOriginal;
  const { status, threads, projects } = experimental_useSidebarThreads();
  const providerDirectory = experimental_useProviders();
  const pluginSettings = useSettings();
  const actions = experimental_useSidebarThreadActions();
  const queryClient = useQueryClient();
  const threadPreferences = useThreadPreferences();
  const [view, setView] = useState<SidebarView>("work");
  const queuedMessagesByThread = useSidebarQueuedMessages(view === "work");
  const recycleBin = useRecycleBin();
  const binnedIds = useMemo(
    () => new Set((recycleBin.bin.data ?? []).map((entry) => entry.threadId)),
    [recycleBin.bin.data],
  );
  const liveThreads = useMemo(() => threads.filter((thread) => !thread.isArchived && !binnedIds.has(thread.id)), [binnedIds, threads]);
  // One project-roster read owns the normalized PR facts for the entire
  // frontend generation. Consumers only observe this cache; none issue
  // per-row PR reads.
  const threadPullRequests = useSidebarThreadPullRequestDirectory(
    liveThreads.map((thread) => thread.id),
    status === "ready",
  );
  // Sole task-links observer, including native mode: Agents and WorkThreadTree share one
  // cache and polling owner rather than creating per-consumer intervals.
  const { data: taskLinksData, refetch: refetchTaskLinks } = useTaskLinksRead();
  const [threadSearchQuery, setThreadSearchQuery] = useState("");
  const [subtextRefreshKey, setSubtextRefreshKey] = useState(0);
  const providersById = useMemo(
    () =>
      new Map(
        providerDirectory.providers.map((provider) => [provider.id, provider]),
      ),
    [providerDirectory.providers],
  );
  const taskOwnerThreads = useMemo(
    () =>
      view === "queue"
        ? new Map(
            liveThreads.map((thread) => [
              thread.id,
              {
                title: threadTitle(thread),
                providerId: thread.providerId,
                provider: providersById.get(thread.providerId),
              },
            ]),
          )
        : EMPTY_TASK_OWNER_THREADS,
    [liveThreads, providersById, view],
  );
  const pullRequestThreads = useMemo(
    () =>
      view === "prs"
        ? liveThreads.map((thread) => ({
            id: thread.id,
            title: threadTitle(thread),
            branchName: thread.environment?.branchName ?? null,
            parentThreadId: thread.parentThreadId,
            providerId: thread.providerId,
            provider: providersById.get(thread.providerId),
          }))
        : EMPTY_PULL_REQUEST_THREADS,
    [liveThreads, providersById, view],
  );
  const groupPreferences = threadPreferences.groups.data ?? { groups: [], activeGroupPosition: 0, disclosures: {} };
  const threadCount = useMemo(
    () => threadCountPresentation(liveThreads),
    [liveThreads],
  );
  const saveGroups = useCallback(
    (
      groups: Parameters<
        typeof threadPreferences.saveGroups.mutateAsync
      >[0]["groups"],
      activeGroupPosition = groupPreferences.activeGroupPosition,
    ) => {
      void threadPreferences.saveGroups
        .mutateAsync({ groups, activeGroupPosition, disclosures: groupPreferences.disclosures ?? {} })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save thread groups",
          );
        });
    },
    [groupPreferences.activeGroupPosition, threadPreferences.saveGroups],
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
  const saveGroupDisclosure = useGroupDisclosurePreference(groupPreferences, threadPreferences.saveGroups);
  const effectiveThreadSearchQuery = threadSearchQuery || props.searchQuery;
  const organization = useSidebarThreadOrganization({
    active: view === "work",
    threads: liveThreads,
    hierarchyThreads: threads.filter((thread) => !thread.isArchived),
    projects,
    order: threadPreferences.order.data ?? [],
    groups: groupPreferences.groups,
    activeGroupPosition: groupPreferences.activeGroupPosition,
    searchQuery: effectiveThreadSearchQuery,
    saveGroups,
    saveOrder,
    bin: async (threadId, originGroupId) =>
      recycleBin.binThread.mutateAsync({ threadId, originGroupId }),
    restore: async (threadId, groupIds) =>
      recycleBin.restore.mutateAsync({ threadId, groupIds }),
  });
  useEffect(() => {
    const threadIds = threads.map((thread) => thread.id);
    threadInteractionStore.getState().reconcileRoster(threadIds);
  }, [threads]);
  const refreshThreadDetails = useCallback(async () => {
    setSubtextRefreshKey((current) => current + 1);
    await Promise.all([
      threadPreferences.order.refetch(),
      threadPreferences.groups.refetch(),
      refetchTaskLinks(),
      invalidateSidebarPullRequestStacks(queryClient),
      invalidateThreadPullRequestDirectory(queryClient),
      queryClient.invalidateQueries({
        queryKey: threadQueryKeys.archived(),
      }),
      queryClient.invalidateQueries({
        queryKey: threadQueryKeys.recycleBin(),
      }),
    ]);
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

  const taskLinks = taskLinksData?.links ?? {};
  const textScale = threadPreferences.appearance.data?.textScale ?? DEFAULT_TEXT_SCALE;
  const workingProviderAnimation = threadPreferences.appearance.data?.workingProviderAnimation ?? DEFAULT_WORKING_PROVIDER_ANIMATION;
  const groupActivityPriority = threadPreferences.appearance.data?.groupActivityPriority ?? DEFAULT_GROUP_ACTIVITY_PRIORITY;
  const settings = (
    <ThreadListSettings
      rowHeight={threadPreferences.appearance.data?.rowHeight}
      rowHeightPending={threadPreferences.saveRowHeight.isPending}
      onSaveRowHeight={(rowHeight) =>
        threadPreferences.saveRowHeight.mutateAsync(rowHeight)
      }
      textScale={threadPreferences.appearance.data?.textScale}
      textScalePending={threadPreferences.saveTextScale.isPending}
      onSaveTextScale={(textScale) =>
        threadPreferences.saveTextScale.mutateAsync(textScale)
      }
      groups={
        view === "work"
          ? {
              groupPositions: organization.groupPositions,
              occupiedGroupIds: organization.occupiedGroupIds,
              groupReorderPending: threadPreferences.saveGroups.isPending,
              onAddGroup: organization.addGroup,
              onMoveGroup: organization.moveGroup,
              onReorderGroup: organization.reorderGroup,
              onRenameGroup: organization.renameGroup,
              onRemoveGroup: organization.removeGroup,
            }
          : undefined
      }
    />
  );
  const toolbar = (
    <SidebarThreadToolbar
      threadCountLabel={threadCount.label}
      selectedCount={organization.selectedThreadIds.size}
      reorderDisabled={organization.reorderDisabled}
      settings={settings}
      activeProjectId={props.activeProjectId}
      onBinSelected={() => void organization.binSelected()}
      onRefresh={refreshThreadDetails}
      searchQuery={threadSearchQuery}
      onSearchQueryChange={setThreadSearchQuery}
      onNewThread={(projectId) =>
        actions.openNewThread({ projectId, focusPrompt: true })
      }
    />
  );
  return (
    <TextScaleProvider scale={textScale}>
      <div
        className="ws-list"
        data-working-provider-animation={workingProviderAnimation}
        style={
          {
            "--ws-sidebar-row-height": `${threadPreferences.appearance.data?.rowHeight ?? DEFAULT_SIDEBAR_ROW_HEIGHT}px`,
            ...textScaleStyle(textScale),
          } as CSSProperties
        }
      >
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
          taskLinks={taskLinks}
          ownerThreads={taskOwnerThreads}
          onOpenThread={navigateToThread}
          searchQuery={props.searchQuery}
          settingsControl={settings}
        />
        <PullRequestsLeftSidebar
          active={view === "prs"}
          searchQuery={props.searchQuery}
          threads={pullRequestThreads}
          threadPullRequests={threadPullRequests.data}
          onOpenThread={navigateToThread}
          settingsControl={settings}
          externalOnModifier={
            threadPreferences.appearance.data
              ?.openPrLinksExternallyWithModifier ??
            DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER
          }
        />
        {view === "work" && (
          <ThreadHierarchyProvider
            threads={liveThreads}
            taskLinks={taskLinks}
            ready={taskLinksData !== undefined}
          >
            <SidebarWorkView
              toolbar={toolbar}
              organization={organization}
              activeThreadId={props.activeThreadId}
              providersById={providersById}
              onNavigate={props.onNavigate}
              subtextRefreshKey={subtextRefreshKey}
              staleWorkingMinutes={Number(
                pluginSettings.values?.stuckThreadMinutes ?? "30",
              )}
              queuedMessagesByThread={queuedMessagesByThread}
              groupActivityPriority={groupActivityPriority}
              searchQuery={effectiveThreadSearchQuery}
              emptyMessage={
                effectiveThreadSearchQuery
                  ? `No threads match “${effectiveThreadSearchQuery}”.`
                  : "No active threads."
              }
          recycleBinEntries={recycleBin.bin.data ?? []}
          allThreads={threads.filter((thread) => !thread.isArchived)}
          disclosures={groupPreferences.disclosures ?? {}}
          onDisclosureChange={saveGroupDisclosure}
          disclosuresReady={threadPreferences.groups.isSuccess}
          pullRequestsByThread={threadPullRequests.data}
          pullRequestsLoading={threadPullRequests.isPending}
        />
            <ThreadHierarchyPickerHost />
          </ThreadHierarchyProvider>
        )}
      </div>
    </TextScaleProvider>
  );
}
