import { useSettings, useRpc } from "@get-bb/plugin-sdk/app";
import { useQueryClient } from "@tanstack/react-query";
import { useStore } from "zustand";
import { toast } from "sonner";
import { useEffect } from "react";
import type { rpcContract } from "../../contracts";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import {
  useGitHubApiHealth,
  hydratePullRequestFacts,
  useSharedPullRequestFactDirectory,
} from "../pull-requests/queries";
import {
  factFromPullRequest,
  factFromSidebarStackLayer,
  pullRequestFactForThread,
  pullRequestFromFact,
  resolvePullRequestFact,
} from "../pull-requests/facts";
import {
  githubHealthPresentation,
  pullRequestSummaryPresentation,
} from "../pull-requests/presentation";
import { StackNumberBadge } from "../pull-requests/stack-number";
import { useSidebarAppearance } from "../threads/queries";
import { DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER } from "../threads/sidebar-appearance";
import { mergeStackBranchSignals } from "./model";
import {
  useChanges,
  useCheckoutStackBranch,
  usePullRequestFileDiff,
  useWorkingTreeFileDiff,
} from "./queries";
import { changesInteractionStore } from "./store";
import {
  ChangesCurrentPullRequestRow,
  ChangesError,
  ChangesRepositoryCard,
  ChangesStackBranchRow,
  ChangesWorkingTreePreview,
} from "./views";

export function ChangesPanel({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const { values: pluginSettings } = useSettings();
  const changesQuery = useChanges(rpc, threadId, {
    visiblePollMs:
      Number(pluginSettings?.githubActivePollSeconds ?? "60") * 1_000,
    backgroundPollMs:
      Number(pluginSettings?.githubBackgroundPollSeconds ?? "300") * 1_000,
  });
  const pullRequestFacts = useSharedPullRequestFactDirectory();
  const sidebarAppearance = useSidebarAppearance();
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
  const selectedPullRequestNumber =
    presentation?.selectedPullRequestNumber ?? null;
  const workingTreeDiff = useWorkingTreeFileDiff(
    rpc,
    threadId,
    changesQuery.fingerprint.data?.fingerprint ?? null,
    selectedPullRequestNumber ? null : selectedFilePath,
  );
  const pullRequestDiff = usePullRequestFileDiff(
    rpc,
    threadId,
    selectedPullRequestNumber,
    selectedPullRequestNumber ? selectedFilePath : null,
  );
  const checkout = useCheckoutStackBranch(rpc, threadId);
  const expandedStackBranches =
    presentation?.expandedStackBranches ?? new Set<string>();
  const openWorkingTreeDiff = (path: string) =>
    changesInteractionStore.getState().selectFile(threadId, path);
  const openPullRequestDiff = (pullRequestNumber: number, path: string) =>
    changesInteractionStore
      .getState()
      .selectFile(threadId, path, pullRequestNumber);
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
  const projectedPullRequest = changesQuery.data?.currentPullRequest ?? null;
  useEffect(() => {
    const changes = changesQuery.data;
    if (!changes) return;
    const facts = [
      ...(changes.currentPullRequest
        ? [factFromPullRequest(changes.currentPullRequest)]
        : []),
      ...(changes.stack?.pullRequests.map(factFromSidebarStackLayer) ?? []),
    ];
    hydratePullRequestFacts(
      queryClient,
      facts,
    );
  }, [changesQuery.data, queryClient]);
  const currentPullRequest = projectedPullRequest
    ? resolvePullRequestFact(projectedPullRequest, pullRequestFacts.data)
    : (() => {
        const fact = pullRequestFactForThread(pullRequestFacts.data, threadId);
        return fact ? pullRequestFromFact(fact) : null;
      })();
  const externalOnModifier =
    sidebarAppearance.data?.openPrLinksExternallyWithModifier ??
    DEFAULT_OPEN_PR_LINKS_EXTERNALLY_WITH_MODIFIER;
  const currentPullRequestNumber =
    currentPullRequest?.number ?? changesQuery.data?.stack?.currentPullRequest;
  const currentPullRequestStatus = currentPullRequest
    ? pullRequestSummaryPresentation({
        state: currentPullRequest.state,
        draft: currentPullRequest.state === "draft",
        attention: currentPullRequest.attention,
        signal: currentPullRequest.signal,
      })
    : null;
  const selectedDiffPreview = selectedFilePath ? (
    <ChangesWorkingTreePreview
      path={selectedFilePath}
      query={selectedPullRequestNumber ? pullRequestDiff : workingTreeDiff}
      onClose={() =>
        changesInteractionStore.getState().selectFile(threadId, null)
      }
    />
  ) : null;
  const standaloneBranch = changesQuery.data?.stack
    ? null
    : (githubStack?.branches.find(
        (branch) => branch.pr?.number === currentPullRequestNumber,
      ) ?? null);
  const githubHealth = githubHealthPresentation(githubApiHealth);
  const contextMeta = (
    <>
      {githubHealth ? (
        <ActionTooltip label={githubHealth.detail}>
          {(tooltipId) => (
            <span
              className={`ws-github-api-indicator ws-github-api-${githubHealth.tone}`}
              aria-describedby={tooltipId}
            >
              <Icon name={githubHealth.icon} aria-hidden />
              {githubHealth.label}
            </span>
          )}
        </ActionTooltip>
      ) : null}
      {currentPullRequestNumber != null ? (
        <CopyBadge
          value={`#${currentPullRequestNumber}`}
          copyValue={`PR #${currentPullRequestNumber}`}
          label="PR number"
          className="ws-pr-number-badge"
          title={currentPullRequestStatus?.label ?? "Pull request"}
          tone={currentPullRequestStatus?.tone}
        >
          <Icon
            name={currentPullRequestStatus?.icon ?? "GitPullRequest"}
            aria-hidden
          />
          <span aria-hidden>#{currentPullRequestNumber}</span>
        </CopyBadge>
      ) : null}
      {changesQuery.data?.stack?.number != null ? (
        <StackNumberBadge number={changesQuery.data.stack.number} />
      ) : null}
    </>
  );
  return (
    <div className="ws-changes-content">
      <ChangesRepositoryCard
        repository={changesQuery.data?.repository}
        loading={changesQuery.isPending}
        refreshing={changesQuery.isFetching && !changesQuery.isPending}
        expanded={presentation?.repositoryExpanded ?? false}
        contextMeta={contextMeta}
        onToggle={() =>
          changesInteractionStore.getState().toggleRepository(threadId)
        }
        onOpenFile={openWorkingTreeDiff}
        preview={
          selectedPullRequestNumber === null ? selectedDiffPreview : null
        }
      />
      {changesQuery.isError && (
        <ChangesError
          error={changesQuery.error}
          onRetry={() => void changesQuery.refetch()}
        />
      )}
      {!changesQuery.isError &&
        (stack ? (
          <ol
            className="ws-stack-rail"
            aria-label={`GitHub Stack based on ${stack.trunk}`}
          >
            {stack.branches.map((branch) => (
              <ChangesStackBranchRow
                key={branch.name}
                branch={branch}
                signals={mergeStackBranchSignals(
                  branch,
                  changesQuery.data!,
                  currentPullRequest,
                  pullRequestFacts.data,
                )}
                expanded={expandedStackBranches.has(branch.name)}
                externalOnModifier={externalOnModifier}
                checkingOut={
                  checkout.isPending && checkout.variables === branch.name
                }
                onToggle={() =>
                  changesInteractionStore
                    .getState()
                    .toggleStackBranch(threadId, branch.name)
                }
                onCheckout={() => checkoutStackBranch(branch.name)}
                onOpenFile={(path) => {
                  if (branch.pr) openPullRequestDiff(branch.pr.number, path);
                }}
                preview={
                  branch.pr?.number === selectedPullRequestNumber
                    ? selectedDiffPreview
                    : null
                }
              />
            ))}
          </ol>
        ) : currentPullRequest ? (
          <ChangesCurrentPullRequestRow
            pullRequest={currentPullRequest}
            branch={standaloneBranch}
            expanded={presentation?.currentPullRequestExpanded ?? false}
            externalOnModifier={externalOnModifier}
            onToggle={() =>
              changesInteractionStore.getState().togglePullRequest(threadId)
            }
            onOpenFile={(path) =>
              openPullRequestDiff(currentPullRequest.number, path)
            }
            preview={
              currentPullRequest.number === selectedPullRequestNumber
                ? selectedDiffPreview
                : null
            }
          />
        ) : !changesQuery.isPending ? (
          <div className="ws-empty">
            No pull request is linked to this thread.
          </div>
        ) : null)}
    </div>
  );
}
