import { useSettings, useRpc } from "@get-bb/plugin-sdk/app";
import { useStore } from "zustand";
import { toast } from "sonner";
import type { rpcContract } from "../../contracts";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { useGitHubApiHealth } from "../pull-requests/queries";
import { StackNumberBadge } from "../pull-requests/stack-number";
import { changesHeaderLabel, mergeStackBranchSignals } from "./model";
import {
  useChanges,
  useCheckoutStackBranch,
  useWorkingTreeFileDiff,
} from "./queries";
import { changesInteractionStore } from "./store";
import {
  ChangesCurrentPullRequestCard,
  ChangesError,
  ChangesRepositoryCard,
  ChangesStackBranchRow,
  ChangesWorkingTreePreview,
} from "./views";

export function ChangesPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const { values: pluginSettings } = useSettings();
  const changesQuery = useChanges(rpc, threadId, {
    visiblePollMs:
      Number(pluginSettings?.githubActivePollSeconds ?? "60") * 1_000,
    backgroundPollMs:
      Number(pluginSettings?.githubBackgroundPollSeconds ?? "300") * 1_000,
  });
  const githubHealthQuery = useGitHubApiHealth(rpc, { poll: false });
  const githubApiHealth = githubHealthQuery.data ?? {
    state: "available" as const,
    scope: "unknown" as const,
    message: null,
    retryAt: null,
  };
  const presentation = useStore(changesInteractionStore, (state) =>
    state.byThread.get(threadId),
  );
  const selectedFilePath = presentation?.selectedFilePath ?? null;
  const workingTreeDiff = useWorkingTreeFileDiff(
    rpc,
    threadId,
    changesQuery.fingerprint.data?.fingerprint ?? null,
    selectedFilePath,
  );
  const checkout = useCheckoutStackBranch(rpc, threadId);
  const expandedStackBranches =
    presentation?.expandedStackBranches ?? new Set<string>();
  const openWorkingTreeDiff = (path: string) =>
    changesInteractionStore.getState().selectFile(threadId, path);
  const checkoutStackBranch = (branch: string) => {
    if (checkout.isPending) return;
    checkout.mutate(branch, {
      onSuccess: (result) =>
        result.ok ? toast.success(result.message) : toast.error(result.message),
      onError: (error) =>
        toast.error(
          error instanceof Error ? error.message : "Could not check out branch",
        ),
    });
  };
  const githubStack = changesQuery.data?.githubStack?.stack;
  const stack =
    changesQuery.data?.stack || (githubStack?.branches.length ?? 0) > 1
      ? githubStack
      : null;
  const currentPullRequestNumber =
    changesQuery.data?.currentPullRequest?.number ??
    changesQuery.data?.stack?.currentPullRequest;
  const standaloneBranch = changesQuery.data?.stack
    ? null
    : githubStack?.branches.find(
        (branch) => branch.pr?.number === currentPullRequestNumber,
      ) ?? null;
  const healthClass =
    githubApiHealth.state === "rate_limited"
      ? "ws-github-api-rate_limited"
      : "ws-github-api-unavailable";
  return (
    <div className="ws-section-stack">
      <header>
        <div>
          <h2>Changes</h2>
        </div>
        <span className="ws-section-count ws-changes-header-meta">
          {githubApiHealth.state !== "available" && (
            <span
              className={`ws-github-api-indicator ${healthClass}`}
              title={githubApiHealth.message ?? "GitHub API is unavailable."}
            >
              <Icon name="AlertCircle" aria-hidden />
              {githubApiHealth.scope === "graphql"
                ? "GraphQL limited"
                : "GitHub unavailable"}
            </span>
          )}
          {currentPullRequestNumber != null ? (
            <CopyBadge
              value={`#${currentPullRequestNumber}`}
              copyValue={`PR #${currentPullRequestNumber}`}
              label="PR number"
              className="ws-pr-number-badge"
              title={`PR #${currentPullRequestNumber}`}
            >
              <Icon name="GitPullRequest" aria-hidden />
              <span aria-hidden>#{currentPullRequestNumber}</span>
            </CopyBadge>
          ) : (
            changesHeaderLabel(
              changesQuery.data,
              changesQuery.isPending,
              changesQuery.isError,
            )
          )}
          {changesQuery.data?.stack?.number != null && (
            <StackNumberBadge number={changesQuery.data.stack.number} />
          )}
        </span>
      </header>
      <ChangesRepositoryCard
        repository={changesQuery.data?.repository}
        loading={changesQuery.isPending}
        expanded={presentation?.repositoryExpanded ?? false}
        onToggle={() =>
          changesInteractionStore.getState().toggleRepository(threadId)
        }
        onOpenFile={openWorkingTreeDiff}
      />
      {selectedFilePath && (
        <ChangesWorkingTreePreview
          path={selectedFilePath}
          query={workingTreeDiff}
          onClose={() =>
            changesInteractionStore.getState().selectFile(threadId, null)
          }
        />
      )}
      {changesQuery.isError && (
        <ChangesError
          error={changesQuery.error}
          onRetry={() => void changesQuery.refetch()}
        />
      )}
      {!changesQuery.isPending &&
        !changesQuery.isError &&
        (stack ? (
          <ol
            className="ws-stack-rail"
            aria-label={`GitHub Stack based on ${stack.trunk}`}
          >
            {stack.branches.map((branch) => (
              <ChangesStackBranchRow
                key={branch.name}
                branch={branch}
                signals={mergeStackBranchSignals(branch, changesQuery.data!)}
                expanded={expandedStackBranches.has(branch.name)}
                checkingOut={
                  checkout.isPending && checkout.variables === branch.name
                }
                onToggle={() =>
                  changesInteractionStore
                    .getState()
                    .toggleStackBranch(threadId, branch.name)
                }
                onCheckout={() => checkoutStackBranch(branch.name)}
              />
            ))}
          </ol>
        ) : changesQuery.data?.currentPullRequest ? (
          <ChangesCurrentPullRequestCard
            pullRequest={changesQuery.data.currentPullRequest}
            branch={standaloneBranch}
            expanded={presentation?.currentPullRequestExpanded ?? false}
            onToggle={() =>
              changesInteractionStore.getState().togglePullRequest(threadId)
            }
          />
        ) : (
          <div className="ws-empty">
            No pull request is linked to this thread.
          </div>
        ))}
    </div>
  );
}
