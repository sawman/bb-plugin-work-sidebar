import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import {
  useRealtime,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "../../components/ui/icon";
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

export function WorkPanel({ threadId }: PluginThreadPanelProps) {
  const queryClient = useQueryClient();
  const status = useWorkStatus(threadId);
  const tab = useStore(
    threadInteractionStore,
    (state) => state.workTabsByThread.get(threadId) ?? "work",
  );
  useEffect(() => {
    threadInteractionStore.getState().touchWorkTab(threadId);
    return () => changesInteractionStore.getState().selectFile(threadId, null);
  }, [threadId]);
  useRealtime("work-sidebar:changed", (payload) => {
    const event = parseWorkSidebarRealtimeEvent(payload);
    if (!event || event.threadId !== threadId) return;
    if (event.family === "work")
      void invalidateWorkContextCards(queryClient, threadId);
    if (event.family === "tracker")
      void invalidateTracker(queryClient, threadId);
    if (event.family === "changes")
      void invalidateChanges(queryClient, threadId);
  });
  const selectedTab =
    WORK_TABS.find((candidate) => candidate.id === tab) ?? WORK_TABS[0]!;
  const selectTab = (next: WorkTab) =>
    threadInteractionStore.getState().setWorkTab(threadId, next);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = WORK_TABS.findIndex((candidate) => candidate.id === tab);
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? WORK_TABS.length - 1
          : (index + (event.key === "ArrowRight" ? 1 : -1) + WORK_TABS.length) %
            WORK_TABS.length;
    const next = WORK_TABS[nextIndex]!;
    selectTab(next.id);
    window.requestAnimationFrame(() =>
      document.getElementById(`ws-tab-${next.id}`)?.focus(),
    );
  };
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
      <nav className="ws-tabs" role="tablist" aria-label="Work context views">
        {WORK_TABS.map((candidate) => (
          <button
            key={candidate.id}
            id={`ws-tab-${candidate.id}`}
            type="button"
            role="tab"
            aria-selected={tab === candidate.id}
            aria-controls={`ws-panel-${candidate.id}`}
            tabIndex={tab === candidate.id ? 0 : -1}
            className={tab === candidate.id ? "ws-tab-active" : ""}
            title={candidate.description}
            onClick={() => selectTab(candidate.id)}
            onKeyDown={onTabKeyDown}
          >
            {candidate.label}
          </button>
        ))}
      </nav>
      <div
        className="ws-panel-body"
        role="tabpanel"
        id={`ws-panel-${selectedTab.id}`}
        aria-labelledby={`ws-tab-${selectedTab.id}`}
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
        <div hidden={tab !== "changes"}>
          <ChangesPanel threadId={threadId} />
        </div>
        {tab === "agents" && <AgentsView threadId={threadId} />}
      </div>
    </div>
  );
}
