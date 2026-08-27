import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import {
  definePluginApp,
  useBbNavigate,
  experimental_useSidebarThreadActions,
  useComposer,
  useComposerView,
  useRealtime,
  useRpc,
  useSettings,
} from "@get-bb/plugin-sdk/app";
import type {
  PluginThreadHeaderActionProps,
  PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { rpcContract } from "./contracts";
import { Icon } from "@/components/ui/icon";
import { useGitHubApiHealth } from "@/features/pull-requests/queries";
import { changesHeaderLabel } from "@/features/changes/model";
import { invalidateChanges, useChanges, useCheckoutStackBranch, useWorkingTreeFileDiff } from "@/features/changes/queries";
import { ChangesCurrentPullRequestCard, ChangesError, ChangesRepositoryCard, ChangesStackBranchRow, ChangesWorkingTreePreview, type StackBranchSignals } from "@/features/changes/views";
import { changesInteractionStore } from "@/features/changes/store";
import { useTaskLinksRead, useTasksRead, useTasksRealtimeInvalidation } from "@/features/tasks/queries";
import { useTasksMutations } from "@/features/tasks/mutations";
import "./app.css";
import "./scrollbar.css";
import "./views.css";
import { withPluginProviders } from "./query-runtime";
import { threadInteractionStore, type WorkTab } from "./features/threads/store";
import { WorkContextCards } from "./features/work-context/views";
import { invalidateWorkContextCards, useLegacyProviderHealth, useLegacyWorkContext } from "./features/work-context/queries";
import { TrackerCard, TrackerHeaderBadge } from "./features/tracker/card";
import { invalidateTracker } from "./features/tracker/queries";
import { AgentsView } from "./features/agents/views";

import { WorkThreadList } from "./features/threads/left-sidebar";

const WORK_TABS: readonly { id: WorkTab; label: string; description: string }[] = [
  { id: "work", label: "Work", description: "Outcome, execution tasks, goal, and plan" },
  { id: "changes", label: "Changes", description: "Pull request, stack, branch, and working-tree state" },
  { id: "agents", label: "Agents", description: "Delegated child threads" },
];

type WorkProviderHealth = { tone: "green" | "amber" | "red"; providerId: string; providerName: string; statusUrl: string | null; status: string; message: string | null };

function WorkPanel({ threadId }: PluginThreadPanelProps) {
  const rpc = useRpc<typeof rpcContract>();
  const { data: tasksData, isPending: tasksReadPending, isError: tasksReadFailed, error: tasksReadError, refetch: refetchTasks } = useTasksRead();
  const queryClient = useQueryClient();
  const taskMutations = useTasksMutations(rpc);
  const { values: pluginSettings } = useSettings();
  const changesQuery = useChanges(rpc, threadId, {
    visiblePollMs: Number(pluginSettings?.githubActivePollSeconds ?? "60") * 1_000,
    backgroundPollMs: Number(pluginSettings?.githubBackgroundPollSeconds ?? "300") * 1_000,
  });
  const githubHealthQuery = useGitHubApiHealth(rpc, { poll: false });
  const githubApiHealth = githubHealthQuery.data ?? { state: "available" as const, scope: "unknown" as const, message: null, retryAt: null };
  const navigate = useBbNavigate();
  const actions = experimental_useSidebarThreadActions();
  const tab = useStore(threadInteractionStore, (state) => state.workTabsByThread.get(threadId) ?? "work");
  useEffect(() => {
    threadInteractionStore.getState().touchWorkTab(threadId);
    return () => changesInteractionStore.getState().selectFile(threadId, null);
  }, [threadId]);
  const legacyContext = useLegacyWorkContext(threadId);
  const legacyProviderHealth = useLegacyProviderHealth(threadId);
  const context = legacyContext.data;
  const loading = legacyContext.isPending;
  const changesLoading = changesQuery.isPending;
  const providerHealth: WorkProviderHealth = legacyProviderHealth.data ?? { tone: "amber", providerId: "", providerName: "Provider", statusUrl: null, status: "unknown", message: "Checking provider health…" };
  const error = legacyContext.error?.message ?? null;
  const changesPresentation = useStore(changesInteractionStore, (state) => state.byThread.get(threadId));
  const pendingChangesExpanded = changesPresentation?.repositoryExpanded ?? false;
  const currentPrExpanded = changesPresentation?.currentPullRequestExpanded ?? false;
  const expandedStackBranches = changesPresentation?.expandedStackBranches ?? new Set<string>();
  const selectedFilePath = changesPresentation?.selectedFilePath ?? null;
  const workingTreeDiff = useWorkingTreeFileDiff(rpc, threadId, changesQuery.fingerprint.data?.fingerprint ?? null, selectedFilePath);
  const checkout = useCheckoutStackBranch(rpc, threadId);

  const refresh = () => legacyContext.refetch();
  const refreshChanges = () => changesQuery.refetch();
  const refreshProviderHealth = () => legacyProviderHealth.refetch();
  const refreshWorkPanel = () => { void refresh(); void invalidateWorkContextCards(queryClient, threadId); void invalidateTracker(queryClient, threadId); void invalidateChanges(queryClient, threadId); void refreshProviderHealth(); };
  useRealtime("work-sidebar:changed", refreshWorkPanel);

  const openWorkingTreeDiff = (path: string) => {
    changesInteractionStore.getState().selectFile(threadId, path);
  };

  const selectedTab = WORK_TABS.find((candidate) => candidate.id === tab) ?? WORK_TABS[0]!;
  const selectTab = (next: WorkTab) => threadInteractionStore.getState().setWorkTab(threadId, next);
  const onTabKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = WORK_TABS.findIndex((candidate) => candidate.id === tab);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? WORK_TABS.length - 1
        : (currentIndex + (event.key === "ArrowRight" ? 1 : -1) + WORK_TABS.length) % WORK_TABS.length;
    const next = WORK_TABS[nextIndex]!;
    selectTab(next.id);
    window.requestAnimationFrame(() => document.getElementById(`ws-tab-${next.id}`)?.focus());
  };
  const tabPanelId = `ws-panel-${selectedTab.id}`;
  const toggleStackBranch = (branch: string) => changesInteractionStore.getState().toggleStackBranch(threadId, branch);
  const checkoutStackBranch = (branch: string) => {
    if (checkout.isPending) return;
    checkout.mutate(branch, {
      onSuccess: (result) => result.ok ? toast.success(result.message) : toast.error(result.message),
      onError: (caught) => toast.error(caught instanceof Error ? caught.message : "Could not check out branch"),
    });
  };

  return (
    <div className="ws-panel">
      <header className="ws-panel-header">
        <div className="ws-panel-heading">
          <Icon name="ListTodo" className="ws-panel-icon" aria-hidden />
          <div><strong>Work</strong><span>{context?.currentThread.title ?? "Active thread"}</span></div>
        </div>
        <button type="button" className="ws-icon-button" aria-label="Refresh work context" title="Refresh work context" onClick={() => { refreshWorkPanel(); void githubHealthQuery.refetch(); }} disabled={loading}>↻</button>
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
          >{candidate.label}</button>
        ))}
      </nav>
      <div
        className="ws-panel-body"
        role="tabpanel"
        id={tabPanelId}
        aria-labelledby={`ws-tab-${selectedTab.id}`}
        tabIndex={0}
      >
        {tab !== "agents" && loading && <div className="ws-empty" role="status" aria-live="polite">Loading work context…</div>}
        {tab !== "agents" && !loading && error && (
          <div className="ws-callout" role="alert">
            <span>{error}</span>
            <button type="button" onClick={() => {
              void refresh();
              void refreshChanges();
              void refreshProviderHealth();
              void githubHealthQuery.refetch();
            }}>Try again</button>
          </div>
        )}
        {tab === "work" && (
          <div className="ws-section-stack">
            <header><div><h2>Work</h2></div><span className="ws-work-header-badges"><TrackerHeaderBadge threadId={threadId} /></span></header>
            <WorkContextCards threadId={threadId} />
            <TrackerCard threadId={threadId} />
          </div>
        )}
        {!loading && context && tab === "changes" && (
          <div className="ws-section-stack">
            <header>
              <div><h2>Changes</h2></div>
              <span className="ws-section-count">
                {githubApiHealth.state !== "available" && (
                  <span
                    className={`ws-github-api-indicator ws-github-api-${githubApiHealth.state}`}
                    title={githubApiHealth.message ?? "GitHub API is unavailable."}
                  >
                    <Icon name="AlertCircle" aria-hidden />
                    {githubApiHealth.scope === "graphql" ? "GraphQL limited" : "GitHub unavailable"}
                  </span>
                )}
                {changesLoading ? "Loading…" : changesHeaderLabel(changesQuery.data, changesQuery.isPending, changesQuery.isError)}
              </span>
            </header>
            <ChangesRepositoryCard
              repository={changesQuery.data?.repository}
              loading={changesLoading}
              expanded={pendingChangesExpanded}
              onToggle={() => changesInteractionStore.getState().toggleRepository(threadId)}
              onOpenFile={openWorkingTreeDiff}
            />
            {selectedFilePath && <ChangesWorkingTreePreview path={selectedFilePath} query={workingTreeDiff} onClose={() => changesInteractionStore.getState().selectFile(threadId, null)} />}
            {changesQuery.isError && <ChangesError error={changesQuery.error} onRetry={() => { void changesQuery.refetch(); }} />}
            {!changesQuery.isPending && !changesQuery.isError && (
              changesQuery.data?.githubStack?.stack ? (
                <ol className="ws-stack-rail" aria-label={`GitHub Stack based on ${changesQuery.data.githubStack.stack.trunk}`}>
                  {changesQuery.data.githubStack.stack.branches.map((branch: any) => {
                    const stackPullRequest = changesQuery.data?.stack?.pullRequests.find(
                      (pullRequest: any) => pullRequest.number === branch.pr?.number || pullRequest.head === branch.name,
                    );
                    const current = branch.pr?.number === changesQuery.data?.currentPullRequest?.number
                      ? changesQuery.data.currentPullRequest
                      : null;
                    const signals = current
                      ? { ...stackPullRequest, state: current.state, draft: current.state === "draft", ...current.signal }
                      : branch.pr
                        ? {
                            ...stackPullRequest,
                            state: stackPullRequest?.state ?? branch.pr.state,
                            draft: stackPullRequest?.draft ?? branch.pr.isDraft,
                            checks: branch.checks ?? stackPullRequest?.checks ?? "unknown",
                            review: branch.review ?? stackPullRequest?.review ?? "none",
                            reviewCommentCount: stackPullRequest?.reviewCommentCount ?? 0,
                          }
                        : stackPullRequest;
                    return (
                      <ChangesStackBranchRow
                        key={branch.name}
                        branch={branch}
                        signals={signals}
                        expanded={expandedStackBranches.has(branch.name)}
                        checkingOut={checkout.isPending && checkout.variables === branch.name}
                        onToggle={() => toggleStackBranch(branch.name)}
                        onCheckout={() => checkoutStackBranch(branch.name)}
                      />
                    );
                  })}
                </ol>
              ) : changesQuery.data?.currentPullRequest ? (
                <ChangesCurrentPullRequestCard pullRequest={changesQuery.data.currentPullRequest} expanded={currentPrExpanded} onToggle={() => changesInteractionStore.getState().togglePullRequest(threadId)} />
              ) : <div className="ws-empty">No pull request is linked to this thread.</div>
            )}
          </div>
        )}
        {tab === "agents" && <AgentsView threadId={threadId} />}
      </div>
    </div>
  );
}

function WorkContextHeaderAction({ isCompactViewport }: PluginThreadHeaderActionProps) {
  const navigate = useBbNavigate();
  return <button type="button" className="ws-header-action" aria-label="Open Work" title="Open Work" onClick={() => { navigate.openThreadPanel({ actionId: "work-context" }); }}>{isCompactViewport ? "▣" : "Work"}</button>;
}

function GitHubPollingSettings() {
  const { values, isLoading } = useSettings();
  return (
    <section className="ws-settings-card">
      <strong>GitHub polling</strong>
      <p>
        Right Work polling checks only the current PR through REST; the left PR
        list refreshes independently. GraphQL remains reserved for batch metadata.
      </p>
      {!isLoading && (
        <small>
          Current policy: right every {values?.githubActivePollSeconds ?? "60"}s
          visible / {values?.githubBackgroundPollSeconds ?? "300"}s hidden; left
          every {values?.githubLeftListRefreshSeconds ?? "300"}s; up to {values?.githubMaxRestPollsPerMinute ?? "30"} REST polls/minute.
        </small>
      )}
    </section>
  );
}

function TrackWorkAction() {
  const rpc = useRpc<typeof rpcContract>();
  const composer = useComposer();
  const view = useComposerView();
  if (view.scope.kind !== "thread") return null;
  const threadId = view.scope.threadId;
  const track = async () => {
    const title = view.draft.text.trim().split("\n")[0]?.slice(0, 100) || "New work";
    try {
      const result = await rpc.call("createWorkTask", { threadId, title, description: view.draft.text, parentTaskId: null });
      composer.updateText((current) => `Work through ${result.task.key}: ${result.task.title}.\n\n${current}`);
      toast.success(`${result.task.key} created and attached`);
    } catch (error) { toast.error(error instanceof Error ? error.message : "Could not track work"); }
  };
  return <button className="ws-track-action" aria-label="Track this work as a task" title="Create and attach a BB task before sending" onClick={() => void track()}>Task</button>;
}

export default definePluginApp((app) => {
  app.slots.settingsSection({ id: "github-polling", title: "GitHub polling", description: "Control Work Sidebar GitHub polling and shared REST budget.", component: withPluginProviders(GitHubPollingSettings) });
  app.slots.experimental_threadList({
    id: "work-queue", title: "Tasks", description: "Global outcome and execution task queue.", component: withPluginProviders(WorkThreadList),
  });
  app.slots.threadPanelAction({
    id: "work-context", title: "Work", icon: "ListTodo", component: withPluginProviders(WorkPanel), layout: "flush",
  });
  app.slots.experimental_threadHeaderAction({
    id: "work-context-header", title: "Work", component: withPluginProviders(WorkContextHeaderAction),
  });
  app.composer.customize({
    id: "task-first", scopes: ["thread"], actions: [{ id: "track-work", component: withPluginProviders(TrackWorkAction) }],
  });
});
