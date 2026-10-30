import { classifyPullRequestError } from "../pull-requests/health";
import { PullRequestReadError } from "../pull-requests/status-error";
import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useNativeThreadPullRequest } from "../pull-requests/native-status-queries";
import { changesKeys } from "./model";
import { useSettings, useRpc } from "@get-bb/plugin-sdk/app";
import { useStore } from "zustand";
import { toast } from "sonner";
import type { rpcContract } from "../../contracts";
import { CopyBadge } from "../../components/ui/copy-badge";
import { Icon } from "../../components/ui/icon";
import { ActionTooltip } from "../../components/ui/action-tooltip";
import {
  useGitHubApiHealth,
  useSharedPullRequestFactDirectory,
} from "../pull-requests/queries";
import {
  pullRequestFactForThread,
  pullRequestFactKey,
  nativeValidationDemands,
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
import { mergeStackBranchSignals, remoteChangesIdentity } from "./model";
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

export function ChangesPanel({ threadId, environmentId }: { threadId: string; environmentId?: string | null }) {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const native = useNativeThreadPullRequest(threadId, environmentId);
  const pullRequestFacts = useSharedPullRequestFactDirectory();
  const nativeKey = native.pullRequest ? pullRequestFactKey(native.pullRequest) : null;
  const validationBound = JSON.stringify(nativeValidationDemands(pullRequestFacts.data, nativeKey) ?? null);
  const previousNative = useRef({ threadId, key: nativeKey, bound: validationBound });
  useEffect(() => {
    const previous = previousNative.current;
    previousNative.current = { threadId, key: nativeKey, bound: validationBound };
    if (previous.threadId === threadId && validationBound !== "null" && validationBound !== previous.bound) {
      // Invalidating an initial fetch alone does not create a successor in
      // Query. Retire that publication before reading the new causal demand.
      void client.cancelQueries({ queryKey: changesKeys.summary(threadId) })
        .then(() => client.invalidateQueries({ queryKey: changesKeys.summary(threadId) }));
    }
    if (previous.threadId === threadId && previous.key && nativeKey !== previous.key) {
      void client.cancelQueries({ queryKey: changesKeys.summary(threadId) })
        .then(() => client.invalidateQueries({ queryKey: changesKeys.summary(threadId) }));
      void client.cancelQueries({ queryKey: changesKeys.projection(threadId) })
        .then(() => client.invalidateQueries({ queryKey: changesKeys.projection(threadId) }));
    }
  }, [client, threadId, nativeKey, validationBound]);
  const { values: pluginSettings } = useSettings();
  const changesQuery = useChanges(rpc, threadId, {
    visiblePollMs:
      Number(pluginSettings?.githubActivePollSeconds ?? "60") * 1_000,
    backgroundPollMs:
      Number(pluginSettings?.githubBackgroundPollSeconds ?? "300") * 1_000,
  }, native.row?.outcome === "available" ? nativeKey : native.row?.outcome === "absent" ? null : undefined);
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
  const selectedRemoteFile = changesQuery.remoteFiles.data?.files.find((entry) => entry.url.endsWith(`/pull/${selectedPullRequestNumber}`));
  const pullRequestDiff = usePullRequestFileDiff(
    rpc,
    threadId,
    selectedPullRequestNumber,
    selectedPullRequestNumber && (changesQuery.data?.currentPullRequest
      || changesQuery.data?.githubStack?.stack?.branches.some((branch) => branch.pr?.number === selectedPullRequestNumber)) ? selectedFilePath : null,
    JSON.stringify([remoteChangesIdentity(changesQuery.data),
      changesQuery.data?.githubStack?.stack?.branches.find((branch) => branch.pr?.number === selectedPullRequestNumber)?.pr?.url,
      selectedRemoteFile?.headSha,
      selectedRemoteFile?.baseSha,
      changesQuery.fingerprint.data?.fingerprint]),
    selectedRemoteFile ? { headSha: selectedRemoteFile.headSha, baseSha: selectedRemoteFile.baseSha } : undefined,
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
  const confirmedAbsent = native.row?.outcome === "absent"
    || native.row?.outcome !== "available" && changesQuery.isSuccess && changesQuery.data?.currentPullRequest === null;
  const projectedPullRequest = confirmedAbsent ? null : native.pullRequest ?? changesQuery.data?.currentPullRequest ?? null;
  const currentPullRequest = projectedPullRequest
    ? resolvePullRequestFact(projectedPullRequest, pullRequestFacts.data)
    : confirmedAbsent ? null : (() => {
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
  // Classify each PR read independently: global backoff must not hide a
  // simultaneous repository, permission, transport or projection failure.
  const nativeFailure = native.error ? classifyPullRequestError(native.error, "unknown") : null;
  const remoteFailures = [changesQuery.error, changesQuery.enrichment.error, changesQuery.remoteFiles.error]
    .filter((error): error is Error => error !== null)
    .map((error) => ({ error, health: classifyPullRequestError(error, "unknown") }));
  const rateLimit = nativeFailure?.state === "rate_limited" ? nativeFailure
    : remoteFailures.find(({ health }) => health.state === "rate_limited")?.health;
  const changesError = changesQuery.repository.error
    ?? remoteFailures.find(({ health }) => health.state !== "rate_limited")?.error;
  const githubHealth = githubHealthPresentation(
    rateLimit && githubApiHealth.state === "available" ? rateLimit : githubApiHealth,
  );
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
          className="ws-pr-identifier-badge ws-pr-number-badge"
          title={currentPullRequestStatus?.label ?? "Pull request"}
          tone={currentPullRequestStatus?.tone}
        >
          <Icon
            name={currentPullRequestStatus?.icon ?? "GitPullRequest"}
            data-motion={
              currentPullRequestStatus?.icon === "LoaderCircle"
                ? "spin"
                : undefined
            }
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
        repository={changesQuery.repository.data}
        loading={changesQuery.repository.isPending}
        refreshing={changesQuery.repository.isFetching && !changesQuery.repository.isPending}
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
      {native.error && nativeFailure?.state !== "rate_limited" && <PullRequestReadError message={native.error} onRetry={() => {
        void native.refetch().then(() => Promise.all([changesQuery.refetch(), changesQuery.enrichment.refetch()]));
      }} />}
      {changesError && (
        <ChangesError
          error={changesError}
          onRetry={() => void changesQuery.refresh().catch(() => { toast.error("Could not refresh Changes."); })}
        />
      )}
      {(stack ? (
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
                expanded={branch.pr
                  ? presentation?.expandedPullRequests.has(pullRequestFactKey(branch.pr)) ?? false
                  : expandedStackBranches.has(branch.name)}
                filesLoading={changesQuery.enrichment.isFetching || changesQuery.remoteFiles.isFetching}
                externalOnModifier={externalOnModifier}
                checkingOut={
                  checkout.isPending && checkout.variables === branch.name
                }
                onToggle={() => {
                  const state = changesInteractionStore.getState();
                  if (branch.pr) state.togglePullRequest(threadId, pullRequestFactKey(branch.pr));
                  else state.toggleStackBranch(threadId, branch.name);
                }}
                checkoutAvailable={changesQuery.localReady}
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
            expanded={presentation?.expandedPullRequests.has(pullRequestFactKey(currentPullRequest)) ?? false}
            filesLoading={changesQuery.enrichment.isFetching || changesQuery.remoteFiles.isFetching}
            externalOnModifier={externalOnModifier}
            onToggle={() =>
              changesInteractionStore.getState().togglePullRequest(threadId, pullRequestFactKey(currentPullRequest))
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
        ) : !changesQuery.isPending && !changesQuery.isError && !native.error ? (
          <div className="ws-empty">
            No pull request is linked to this thread.
          </div>
        ) : null)}
    </div>
  );
}
