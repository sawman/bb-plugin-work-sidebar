import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import {
  useRealtime,
  useBbContext,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { RefreshButton } from "../../components/ui/refresh-button";
import { TabSelector } from "../../components/ui/tab-selector";
import { ChangesPanel } from "../changes/panel";
import { invalidateChanges } from "../changes/queries";
import { changesInteractionStore } from "../changes/store";
import { AgentsView } from "../agents/views";
import { invalidateAgentDetails } from "../agents/queries";
import {
  invalidateGitHubApiHealth,
  invalidateThreadPullRequestDirectory,
} from "../pull-requests/queries";
import { threadInteractionStore, type WorkTab } from "../threads/store";
import { invalidateTracker, useTracker } from "../tracker/queries";
import {
  invalidateWorkContextCards,
  invalidateWorkProviderHealth,
  useWorkStatus,
} from "./queries";
import { parseWorkSidebarRealtimeEvent } from "../../shared/work-realtime";
import { WorkContextCards } from "./views";
import {
  DEFAULT_TEXT_SCALE,
  DEFAULT_WORKING_PROVIDER_ANIMATION,
} from "../threads/sidebar-appearance";
import { useSidebarAppearancePreferences } from "../threads/queries";
import { TextScaleProvider, textScaleStyle } from "../../shared/text-scale";

const WORK_TABS: readonly {
  id: WorkTab;
  label: string;
  description: string;
}[] = [
  {
    id: "work",
    label: "Work",
    description: "Outcome, execution tasks, goal, and plan",
  },
  {
    id: "changes",
    label: "Changes",
    description: "Pull request, stack, branch, and working-tree state",
  },
  { id: "agents", label: "Agents", description: "Delegated child threads" },
];
const MAX_QUEUED_ROOT_EVENTS = 8;

type WorkPanelScope = {
  threadId: string;
  rootThreadId: string | null;
  queuedRootThreadIds: string[];
};

function queueRootEvent(scope: WorkPanelScope, rootThreadId: string) {
  if (scope.queuedRootThreadIds.includes(rootThreadId)) return;
  if (scope.queuedRootThreadIds.length === MAX_QUEUED_ROOT_EVENTS)
    scope.queuedRootThreadIds.shift();
  scope.queuedRootThreadIds.push(rootThreadId);
}

export function WorkPanel({ threadId }: PluginThreadPanelProps) {
  const queryClient = useQueryClient();
  const { projectId } = useBbContext();
  const appearance = useSidebarAppearancePreferences();
  const tab = useStore(
    threadInteractionStore,
    (state) => state.workTabsByThread.get(threadId) ?? "work",
  );
  // The status query establishes root-scoped realtime matching.
  // Poll it only while the Work tab is visible; the other tab panels keep the
  // warm cache and still receive targeted realtime invalidation.
  const status = useWorkStatus(threadId, { poll: tab === "work" });
  const workScopeRef = useRef<WorkPanelScope>({
    threadId,
    rootThreadId: null,
    queuedRootThreadIds: [],
  });
  if (workScopeRef.current.threadId !== threadId)
    workScopeRef.current = {
      threadId,
      rootThreadId: null,
      queuedRootThreadIds: [],
    };
  if (status.data?.rootThreadId)
    workScopeRef.current.rootThreadId = status.data.rootThreadId;
  useEffect(() => {
    threadInteractionStore.getState().touchWorkTab(threadId);
    return () => changesInteractionStore.getState().selectFile(threadId, null);
  }, [threadId]);
  useEffect(() => {
    const scope = workScopeRef.current;
    const rootThreadId = status.data?.rootThreadId;
    if (scope.threadId !== threadId || !rootThreadId) return;
    const shouldInvalidate = scope.queuedRootThreadIds.includes(rootThreadId);
    scope.queuedRootThreadIds = [];
    if (shouldInvalidate)
      void invalidateWorkContextCards(queryClient, scope.threadId);
  }, [queryClient, status.data?.rootThreadId, threadId]);
  useRealtime("work-sidebar:changed", (payload) => {
    const event = parseWorkSidebarRealtimeEvent(payload);
    if (!event) return;
    const scope = workScopeRef.current;
    if (event.family === "work") {
      if (!scope.rootThreadId) {
        queueRootEvent(scope, event.rootThreadId);
        return;
      }
      if (event.rootThreadId !== scope.rootThreadId) return;
      void invalidateWorkContextCards(queryClient, scope.threadId);
      return;
    }
    if (event.threadId !== scope.threadId) return;
    if (event.family === "tracker")
      void invalidateTracker(queryClient, scope.threadId);
    if (event.family === "changes")
      void Promise.all([
        invalidateChanges(queryClient, scope.threadId),
        invalidateThreadPullRequestDirectory(queryClient),
      ]);
  });
  const selectTab = (next: WorkTab) =>
    threadInteractionStore.getState().setWorkTab(threadId, next);
  const tabIdPrefix = `ws-work-${threadId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  const textScale = appearance.appearance.data?.textScale ?? DEFAULT_TEXT_SCALE;
  const workingProviderAnimation =
    appearance.appearance.data?.workingProviderAnimation ??
    DEFAULT_WORKING_PROVIDER_ANIMATION;
  return (
    <TextScaleProvider scale={textScale}>
      <div
        className="ws-panel"
        data-working-provider-animation={workingProviderAnimation}
        style={textScaleStyle(textScale)}
      >
        <div className="ws-panel-tabbar">
          <TabSelector
            ariaLabel="Work context views"
            controls={(id) => `${tabIdPrefix}-panel-${id}`}
            idPrefix={tabIdPrefix}
            items={WORK_TABS}
            value={tab}
            onValueChange={selectTab}
          />
          <RefreshButton
            label="Refresh work context"
            onRefresh={() =>
              Promise.all([
                invalidateWorkContextCards(queryClient, threadId),
                invalidateWorkProviderHealth(
                  queryClient,
                  status.data?.currentThread,
                ),
                invalidateTracker(queryClient, threadId),
                invalidateChanges(queryClient, threadId),
                invalidateAgentDetails(queryClient),
                invalidateGitHubApiHealth(queryClient),
                invalidateThreadPullRequestDirectory(queryClient),
              ])
            }
            disabled={tab === "work" && status.isPending}
          />
        </div>
        <div
          className="ws-panel-body"
          role="tabpanel"
          id={`${tabIdPrefix}-panel-work`}
          aria-labelledby={`${tabIdPrefix}-tab-work`}
          hidden={tab !== "work"}
          tabIndex={0}
        >
          {tab === "work" && (
            <WorkTabContent threadId={threadId} projectId={projectId} />
          )}
        </div>
        <div
          className="ws-panel-body"
          role="tabpanel"
          id={`${tabIdPrefix}-panel-changes`}
          aria-labelledby={`${tabIdPrefix}-tab-changes`}
          hidden={tab !== "changes"}
          tabIndex={0}
        >
          {tab === "changes" && <ChangesPanel threadId={threadId} />}
        </div>
        <div
          className="ws-panel-body"
          role="tabpanel"
          id={`${tabIdPrefix}-panel-agents`}
          aria-labelledby={`${tabIdPrefix}-tab-agents`}
          hidden={tab !== "agents"}
          tabIndex={0}
        >
          {tab === "agents" && (
            <AgentsView threadId={threadId} projectId={projectId} />
          )}
        </div>
      </div>
    </TextScaleProvider>
  );
}

function WorkTabContent({
  threadId,
  projectId,
}: {
  threadId: string;
  projectId: string | null;
}) {
  // Tracker data is displayed only by the Work tab. Mounting its observer here
  // lets inactive Changes and Agents tabs retain the warm cache without a live
  // query subscription.
  const tracker = useTracker(threadId);
  return (
    <WorkContextCards
      threadId={threadId}
      projectId={projectId}
      tracker={tracker}
    />
  );
}
