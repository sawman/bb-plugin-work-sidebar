import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import {
  useRealtime,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
import { TabSelector } from "../../components/ui/tab-selector";
import { ChangesPanel } from "../changes/panel";
import { invalidateChanges } from "../changes/queries";
import { changesInteractionStore } from "../changes/store";
import { AgentsView } from "../agents/views";
import { invalidateGitHubApiHealth } from "../pull-requests/queries";
import { threadInteractionStore, type WorkTab } from "../threads/store";
import { TrackerCard, TrackerHeaderBadge } from "../tracker/card";
import { invalidateTracker } from "../tracker/queries";
import { invalidateWorkContextCards, useWorkStatus } from "./queries";
import { parseWorkSidebarRealtimeEvent } from "../../shared/work-realtime";
import { WorkContextCards } from "./views";

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
  const status = useWorkStatus(threadId);
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
  const tab = useStore(
    threadInteractionStore,
    (state) => state.workTabsByThread.get(threadId) ?? "work",
  );
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
      void invalidateChanges(queryClient, scope.threadId);
  });
  const selectTab = (next: WorkTab) =>
    threadInteractionStore.getState().setWorkTab(threadId, next);
  const tabIdPrefix = `ws-work-${threadId.replace(/[^a-zA-Z0-9_-]/g, "-")}`;
  return (
    <div className="ws-panel">
      <header className="ws-panel-header">
        <div className="ws-panel-heading">
          <Icon name="ListTodo" className="ws-panel-icon" aria-hidden />
          <div>
            <strong>Work</strong>
            <span>{status.data?.currentThread.title ?? "Active thread"}</span>
          </div>
        </div>
        <button
          type="button"
          className="ws-icon-button"
          aria-label="Refresh work context"
          title="Refresh work context"
          onClick={() => {
            void invalidateWorkContextCards(queryClient, threadId);
            void invalidateTracker(queryClient, threadId);
            void invalidateChanges(queryClient, threadId);
            void invalidateGitHubApiHealth(queryClient);
          }}
          disabled={tab === "work" && status.isPending}
        >
          ↻
        </button>
      </header>
      <TabSelector
        ariaLabel="Work context views"
        controls={(id) => `${tabIdPrefix}-panel-${id}`}
        idPrefix={tabIdPrefix}
        items={WORK_TABS}
        value={tab}
        onValueChange={selectTab}
      />
      <div
        className="ws-panel-body"
        role="tabpanel"
        id={`${tabIdPrefix}-panel-work`}
        aria-labelledby={`${tabIdPrefix}-tab-work`}
        hidden={tab !== "work"}
        tabIndex={0}
      >
        {tab === "work" && (
          <div className="ws-section-stack">
            <header>
              <div>
                <h2>Work</h2>
              </div>
              <span className="ws-work-header-badges">
                <TrackerHeaderBadge threadId={threadId} />
              </span>
            </header>
            <WorkContextCards threadId={threadId} />
            <TrackerCard threadId={threadId} />
          </div>
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
        {tab === "agents" && <AgentsView threadId={threadId} />}
      </div>
    </div>
  );
}
