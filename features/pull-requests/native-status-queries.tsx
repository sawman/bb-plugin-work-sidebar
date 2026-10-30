import { useEffect, useMemo } from "react";
import { experimental_useRpcKeyedQuery, useRpc } from "@get-bb/plugin-sdk/app";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GITHUB_PR_STATUS_PLUGIN_ID, nativeStatusContract, environmentPullRequestSchema, nativePullRequestAttention, type PullRequest } from "./native-status-schemas";
import { normalizePullRequestSignal } from "./presentation";
import {
  factFromPullRequest, factFromThreadPullRequest, pullRequestFromFact, pullRequestFactForThread,
  mergePullRequestFacts, mergeNativePullRequestFact, nativeValidationDemands, pullRequestFactKey,
  reconcileThreadPullRequestFactReferences, type PullRequestFactDirectory,
} from "./facts";
import { hydratePullRequestFacts, pullRequestKeys, pullRequestPolicies, useSharedPullRequestFactDirectory } from "./queries";
import type { rpcContract } from "../../contracts";

export function projectNativePullRequest(pullRequest: PullRequest) {
  return {
    number: pullRequest.number, title: pullRequest.title, url: pullRequest.url, state: pullRequest.state,
    head: pullRequest.headRefName, base: pullRequest.baseRefName,
    checks: pullRequest.checks, review: pullRequest.review, mergeability: pullRequest.mergeability,
    attention: nativePullRequestAttention(pullRequest),
    signal: normalizePullRequestSignal({ checks: pullRequest.checks, review: pullRequest.review }),
    observations: Object.fromEntries(["title", "lifecycle", "head", "base", "checks", "checkCounts", "review", "mergeability"].map((group) =>
      [group, { source: "native" as const, validatedAt: null, updatedAt: pullRequest.updatedAt }])),
  };
}

/** Only mounted consumers opt in. BB owns keyed rows, watches, retries and freshness. */
export function useNativeThreadPullRequest(threadId: string, environmentId: string | null | undefined) {
  const client = useQueryClient();
  const query = experimental_useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID, contract: nativeStatusContract,
    method: "pullRequests", keys: environmentId ? [environmentId] : [], enabled: Boolean(environmentId),
  });
  const rawRow = environmentId ? query.data?.[environmentId] : undefined;
  // The host keyed store transports JSON; it does not validate each output row.
  const parsed = useMemo(() => rawRow === undefined ? null : environmentPullRequestSchema.safeParse(rawRow), [rawRow]);
  const row = parsed?.success ? parsed.data : undefined;
  useEffect(() => {
    // An unavailable or omitted row is never evidence that an association disappeared.
    if (environmentId === undefined || (environmentId !== null && (!row || row.outcome === "unavailable"))) return;
    client.setQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory(), (current) => {
      const pullRequest = row?.outcome === "available" ? projectNativePullRequest(row.pullRequest) : null;
      const fact = pullRequest ? factFromPullRequest(pullRequest) : null;
      const merged = fact ? mergeNativePullRequestFact(current, fact) : mergePullRequestFacts(current, []);
      const references = { ...merged.threadFactKeys };
      delete references[threadId];
      if (pullRequest) references[threadId] = pullRequestFactKey(pullRequest);
      return reconcileThreadPullRequestFactReferences(merged, references);
    });
  }, [client, threadId, environmentId, row]);
  const error = !environmentId ? null : query.error?.message ?? (parsed && !parsed.success ? "PR status provider returned an invalid environment row." : null) ?? (row?.outcome === "unavailable" ? row.message
    : environmentId && !row && !query.isFetching ? "PR status provider omitted this environment." : null);
  return {
    ...query, row,
    pullRequest: row?.outcome === "available" ? projectNativePullRequest(row.pullRequest) : null,
    error,
  };
}

/** Manual refresh rechecks only keys currently subscribed through BB's keyed owner. */
export function useNativePullRequestRefresh() {
  return experimental_useRpcKeyedQuery({
    pluginId: GITHUB_PR_STATUS_PLUGIN_ID, contract: nativeStatusContract,
    method: "pullRequests", keys: [], enabled: false,
  }).refetch;
}

/** Scoped Stack/reviewer enrichment supplements the host row, never an eager roster. */
export function useObservedThreadPullRequest(threadId: string, environmentId: string | null | undefined) {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const native = useNativeThreadPullRequest(threadId, environmentId);
  const facts = useSharedPullRequestFactDirectory();
  const pullRequest = native.pullRequest;
  const key = pullRequest ? pullRequestFactKey(pullRequest) : null;
  const validationDemand = nativeValidationDemands(facts.data, key);
  const enrichment = useQuery({
    queryKey: [...pullRequestKeys.threadDirectory(), threadId, key, validationDemand ?? null],
    queryFn: async ({ signal }) => {
      const result = await rpc.call("sidebarThreadPullRequests", { threadIds: [threadId],
        ...(key && validationDemand ? { validationRequirements: { [key]: validationDemand } } : {}) });
      if (!result.available) throw new Error(result.error ?? "Pull request enrichment unavailable.");
      const entry = result.pullRequests[threadId];
      if (entry === undefined) throw new Error("Pull request enrichment omitted this thread.");
      if (entry && !signal.aborted) {
        const fact = factFromThreadPullRequest(entry);
        hydratePullRequestFacts(client, [fact]);
      }
      return entry;
    },
    ...pullRequestPolicies.threadDirectory,
    enabled: Boolean(pullRequest && validationDemand) && !native.error,
  });
  const fact = pullRequest ? facts.data?.facts[pullRequestFactKey(pullRequest)] : undefined;
  const retained = native.row?.outcome === "absent" ? null : pullRequestFactForThread(facts.data, threadId);
  const displayed = pullRequest && fact ? pullRequestFromFact(fact) : pullRequest ?? (retained ? pullRequestFromFact(retained) : null);
  const detail = enrichment.data?.url === pullRequest?.url ? enrichment.data : null;
  return {
    pullRequest: displayed ? { ...displayed, stackNumber: detail?.stackNumber ?? null } : null,
    isLoading: native.isLoading,
    error: native.error ?? enrichment.error?.message ?? null,
  };
}
