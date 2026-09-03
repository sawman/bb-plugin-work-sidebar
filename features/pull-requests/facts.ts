import type {
  AuthoredPullRequestContract,
  PullRequestFactContract,
  PullRequestContract,
  ThreadPullRequestContract,
} from "./schemas";
import type { z } from "zod";
import type { sidebarStackLayer } from "./schemas";
import { normalizePullRequestSignal, pullRequestAttentionFromSignal } from "./presentation";

/**
 * The stable GitHub identity shared by the authored list, thread directory,
 * and Changes projection. A URL is the only identity present in every host
 * response, so it remains the cache key when a repository cannot be parsed.
 */
export function pullRequestFactKey(input: { url: string; number: number }) {
  const match = input.url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d+\/?$/i);
  return match ? `${match[1].toLowerCase()}#${input.number}` : input.url;
}

export type PullRequestFact = PullRequestFactContract;

export type PullRequestFactDirectory = {
  facts: Record<string, PullRequestFact>;
  threadFactKeys: Record<string, string>;
};
export const MAX_PULL_REQUEST_FACTS = 500;
export const MAX_THREAD_PULL_REQUEST_REFERENCES = 1_000;

function factFromSignal(input: {
  number: number;
  title: string;
  url: string;
  state: PullRequestFact["state"];
  draft: boolean;
  head: string;
  base: string;
  attention?: string | null;
  checks: PullRequestContract["checks"] | ReturnType<typeof normalizePullRequestSignal>["checks"];
  review: PullRequestContract["review"] | ReturnType<typeof normalizePullRequestSignal>["review"];
  approvers?: string[];
  changeRequesters?: string[];
  requestedReviewers?: string[];
  reviewCommentCount: number;
  mergeability?: PullRequestContract["mergeability"] | null;
}): PullRequestFact {
  const signal = normalizePullRequestSignal(input);
  return {
    key: pullRequestFactKey(input),
    number: input.number,
    title: input.title,
    url: input.url,
    state: input.state,
    draft: input.draft,
    head: input.head,
    base: input.base,
    attention:
      (input.attention as PullRequestFact["attention"] | undefined) ??
      pullRequestAttentionFromSignal(signal),
    signal,
    checks: typeof input.checks === "string" ? null : input.checks,
    review: typeof input.review === "string" ? null : input.review,
    mergeability: input.mergeability ?? null,
  };
}

export function factFromThreadPullRequest(
  pullRequest: ThreadPullRequestContract,
): PullRequestFact {
  return factFromSignal({
    ...pullRequest,
    draft: pullRequest.state === "draft",
    approvers: pullRequest.signal.approvers,
    changeRequesters: pullRequest.signal.changeRequesters,
    requestedReviewers: pullRequest.signal.requestedReviewers,
    reviewCommentCount: pullRequest.signal.reviewCommentCount,
  });
}

export function factFromPullRequest(
  pullRequest: PullRequestContract,
): PullRequestFact {
  return factFromSignal({
    ...pullRequest,
    draft: pullRequest.state === "draft",
    approvers: pullRequest.signal.approvers,
    changeRequesters: pullRequest.signal.changeRequesters,
    requestedReviewers: pullRequest.signal.requestedReviewers,
    reviewCommentCount: pullRequest.signal.reviewCommentCount,
  });
}

export function factFromSidebarStackLayer(
  pullRequest: z.infer<typeof sidebarStackLayer>,
): PullRequestFact {
  const state = ["closed", "draft", "merged", "open"].includes(
    pullRequest.state,
  )
    ? (pullRequest.state as PullRequestFact["state"])
    : pullRequest.draft
      ? "draft"
      : "open";
  return factFromSignal({
    ...pullRequest,
    state,
    attention: pullRequest.attention ?? undefined,
    mergeability: null,
  });
}

export function factFromAuthoredPullRequest(
  pullRequest: AuthoredPullRequestContract,
): PullRequestFact {
  return factFromSignal(pullRequest);
}

/** Merge source records without letting a partial stack layer erase rich facts. */
export function mergePullRequestFact(
  previous: PullRequestFact | undefined,
  incoming: PullRequestFact,
): PullRequestFact {
  if (!previous) return incoming;
  const previousIsDetailed = Boolean(
    previous.checks || previous.review || previous.mergeability,
  );
  const incomingIsDetailed = Boolean(
    incoming.checks || incoming.review || incoming.mergeability,
  );
  // Authored and stack envelopes intentionally carry only lightweight
  // signals. They can seed a fact, but must not erase a detailed current-PR
  // or thread-directory fact while the next shared refresh is in flight.
  if (previousIsDetailed && !incomingIsDetailed)
    return {
      ...previous,
      title: incoming.title,
      url: incoming.url,
      state: previous.state,
      draft: previous.draft,
      head: incoming.head || previous.head,
      base: incoming.base || previous.base,
    };
  return {
    ...previous,
    ...incoming,
    attention: incoming.attention ?? previous.attention,
    checks: incoming.checks ?? previous.checks,
    review: incoming.review ?? previous.review,
    mergeability: incoming.mergeability ?? previous.mergeability,
  };
}

export function mergePullRequestFacts(
  previous: PullRequestFactDirectory | undefined,
  incoming: readonly PullRequestFact[],
  threadFactKeys: Readonly<Record<string, string>> = {},
): PullRequestFactDirectory {
  const facts: Record<string, PullRequestFact> = {
    ...(previous?.facts ?? {}),
  };
  for (const fact of incoming) {
    // Refreshing an existing fact moves it to the newest end of the bounded
    // directory. Object insertion order gives this cache a small, transparent
    // LRU without mirroring remote data in an interaction store.
    const existing = facts[fact.key];
    delete facts[fact.key];
    facts[fact.key] = mergePullRequestFact(existing, fact);
  }
  for (const key of Object.keys(facts).slice(0, -MAX_PULL_REQUEST_FACTS))
    delete facts[key];
  const nextThreadFactKeys = {
    ...(previous?.threadFactKeys ?? {}),
    ...threadFactKeys,
  };
  for (const [threadId, key] of Object.entries(nextThreadFactKeys))
    if (!facts[key]) delete nextThreadFactKeys[threadId];
  return { facts, threadFactKeys: nextThreadFactKeys };
}

/**
 * A thread directory is a complete active-roster snapshot, unlike an
 * authored/Changes payload. Replace its relationships atomically so a thread
 * that leaves a project cannot retain a stale PR association in the shared
 * directory. Facts remain bounded and reusable until Query garbage collection.
 */
export function reconcileThreadPullRequestFactReferences(
  directory: PullRequestFactDirectory,
  threadFactKeys: Readonly<Record<string, string>>,
): PullRequestFactDirectory {
  const references = Object.entries(threadFactKeys)
    .filter(([, key]) => Boolean(directory.facts[key]))
    .slice(-MAX_THREAD_PULL_REQUEST_REFERENCES);
  return {
    ...directory,
    threadFactKeys: Object.fromEntries(references),
  };
}

export function pullRequestFactForThread(
  directory: PullRequestFactDirectory | undefined,
  threadId: string,
) {
  const key = directory?.threadFactKeys[threadId];
  return key ? directory?.facts[key] ?? null : null;
}

export function pullRequestFromFact(fact: PullRequestFact): PullRequestContract {
  return {
    number: fact.number,
    title: fact.title,
    url: fact.url,
    state: fact.state,
    head: fact.head,
    base: fact.base,
    checks: fact.checks ?? {
      failedCount: 0,
      passedCount: 0,
      pendingCount: 0,
      state: "unknown",
      totalCount: 0,
    },
    review: fact.review ?? {
      reviewRequestCount: fact.signal.requestedReviewers?.length ?? 0,
      state: fact.signal.review,
    },
    attention: fact.attention ?? pullRequestAttentionFromSignal(fact.signal),
    mergeability: fact.mergeability ?? {
      mergeStateStatus: "UNKNOWN",
      mergeable: "UNKNOWN",
      state: "unknown",
    },
    signal: fact.signal,
  };
}

export function resolvePullRequestFact<T extends {
  url: string;
  number: number;
  state: PullRequestFact["state"];
}>(fallback: T, facts: PullRequestFactDirectory | undefined): T & {
  signal: PullRequestFact["signal"];
  attention: string | null;
} {
  const fact = facts?.facts[pullRequestFactKey(fallback)];
  if (!fact) {
    const signal = "signal" in fallback
      ? (fallback.signal as PullRequestFact["signal"])
      : normalizePullRequestSignal(fallback as never);
    return {
      ...fallback,
      signal,
      attention: ("attention" in fallback
        ? (fallback.attention as string | null | undefined)
        : pullRequestAttentionFromSignal(signal)) ?? null,
    };
  }
  return {
    ...fallback,
    state: fact.state as T["state"],
    title: fact.title,
    url: fact.url,
    head: fact.head,
    base: fact.base,
    signal: fact.signal,
    attention: fact.attention,
  };
}
