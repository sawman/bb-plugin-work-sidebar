import type {
  AuthoredPullRequestContract,
  PullRequestFactContract,
  PullRequestContract,
  ThreadPullRequestContract,
  PullRequestObservations,
  PullRequestValidationDemand,
} from "./schemas";
import { incomingObservationWins, observationValidationTime, observationsCompatible, type ObservationGroup } from "./observations";
import type { z } from "zod";
import type { sidebarStackLayer } from "./schemas";
import {
  normalizePullRequestSignal,
  pullRequestAttentionFromSignal,
  type PullRequestSignal,
} from "./presentation";

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
  /** Maximum actual upstream validation time; field groups still own order. */
  observedAtByFact?: Record<string, number>;
  nativeByFact?: Record<string, {
    client: string;
    groups: Partial<Record<ObservationGroup, PullRequestValidationDemand>>;
  }>;
};
export const MAX_PULL_REQUEST_FACTS = 500;
export const MAX_THREAD_PULL_REQUEST_REFERENCES = 1_000;

function factFromSignal(input: {
  observations?: PullRequestObservations;
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
  reviewCommentCounts?: PullRequestSignal["reviewCommentCounts"];
  mergeability?: PullRequestContract["mergeability"] | null;
}): PullRequestFact {
  const signal = normalizePullRequestSignal(input);
  return {
    key: pullRequestFactKey(input),
    ...(input.observations ? { observations: input.observations } : {}),
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
  const fact = factFromSignal({
    ...pullRequest,
    draft: pullRequest.state === "draft",
    approvers: pullRequest.signal.approvers,
    changeRequesters: pullRequest.signal.changeRequesters,
    requestedReviewers: pullRequest.signal.requestedReviewers,
    reviewCommentCount: pullRequest.signal.reviewCommentCount,
    reviewCommentCounts: pullRequest.signal.reviewCommentCounts,
  });
  return { ...fact, signal: pullRequest.signal,
    checks: normalizePullRequestSignal(pullRequest).checks === pullRequest.signal.checks ? pullRequest.checks : null };
}

export function factFromPullRequest(
  pullRequest: PullRequestContract,
): PullRequestFact {
  const fact = factFromSignal({
    ...pullRequest,
    draft: pullRequest.state === "draft",
    approvers: pullRequest.signal.approvers,
    changeRequesters: pullRequest.signal.changeRequesters,
    requestedReviewers: pullRequest.signal.requestedReviewers,
    reviewCommentCount: pullRequest.signal.reviewCommentCount,
    reviewCommentCounts: pullRequest.signal.reviewCommentCounts,
  });
  return { ...fact, signal: pullRequest.signal,
    checks: normalizePullRequestSignal(pullRequest).checks === pullRequest.signal.checks ? pullRequest.checks : null };
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
    mergeability: pullRequest.mergeability ?? null,
  });
}

export function factFromAuthoredPullRequest(
  pullRequest: AuthoredPullRequestContract,
): PullRequestFact {
  return factFromSignal(pullRequest);
}

/** One field-aware partial order for every producer and presentation surface. */
export function mergePullRequestFact(
  previous: PullRequestFact | undefined,
  incoming: PullRequestFact,
): PullRequestFact {
  if (!previous) {
    if (!incoming.observations?.comments || observationsCompatible(incoming.observations.comments, incoming.observations.review, true)) return incoming;
    const signal = { ...incoming.signal, reviewCommentCount: 0 };
    delete signal.reviewCommentCounts;
    const observations = { ...incoming.observations }; delete observations.comments;
    return { ...incoming, signal, observations };
  }
  const next: PullRequestFact = { ...previous, signal: { ...previous.signal } };
  const clocks = { ...previous.observations };
  const retiredEpochs = new Set(previous.retiredEpochs ?? []);
  const previousEpochs = new Set(Object.values(previous.observations ?? {}).flatMap((clock) => clock?.epoch ? [clock.epoch] : []));
  const accepts = (group: ObservationGroup, metadata = false) => {
    // An observed envelope explicitly enumerates the groups it actually read.
    if (incoming.observations && !incoming.observations[group]) return false;
    const epoch = incoming.observations?.[group]?.epoch;
    if (epoch && retiredEpochs.has(epoch)) return false;
    const incomingClock = incoming.observations?.[group];
    if (!metadata && incomingClock?.headRef && incomingClock.headRef !== next.head) return false;
    if (!metadata && incomingClock?.baseRef && incomingClock.baseRef !== next.base) return false;
    if (!metadata && incomingClock?.headSha && clocks.head?.headSha && incomingClock.headSha !== clocks.head.headSha) return false;
    if (!metadata && incomingClock?.baseSha && clocks.base?.baseSha && incomingClock.baseSha !== clocks.base.baseSha) return false;
    if (!incomingObservationWins(previous.observations?.[group], incoming.observations?.[group], metadata)) return false;
    if (incoming.observations?.[group]) clocks[group] = incoming.observations[group];
    if (epoch && !previousEpochs.has(epoch)) for (const previousEpoch of previousEpochs) retiredEpochs.add(previousEpoch);
    return true;
  };
  if (accepts("title", true)) next.title = incoming.title;
  if (accepts("head", true)) next.head = incoming.head;
  if (accepts("base", true)) next.base = incoming.base;
  if (accepts("lifecycle", true)) { next.state = incoming.state; next.draft = incoming.draft; }
  const checksChanged = accepts("checks");
  if (checksChanged) {
    next.signal.checks = incoming.signal.checks;
    next.checks = incoming.checks;
    if (!incoming.checks) delete clocks.checkCounts;
  }
  const reviewChanged = accepts("review");
  if (reviewChanged) {
    next.signal.review = incoming.signal.review;
    next.review = incoming.review;
  }
  const identityChanged = next.head !== previous.head || next.base !== previous.base
    || Boolean(previous.observations?.head?.headSha && clocks.head?.headSha && previous.observations.head.headSha !== clocks.head.headSha)
    || Boolean(previous.observations?.base?.baseSha && clocks.base?.baseSha && previous.observations.base.baseSha !== clocks.base.baseSha);
  if (identityChanged && !checksChanged) { next.signal.checks = "unknown"; next.checks = null; delete clocks.checks; delete clocks.checkCounts; }
  if (identityChanged && !reviewChanged) { next.signal.review = "none"; next.review = null; delete clocks.review; }
  const compatibleReview = !identityChanged && observationsCompatible(previous.observations?.review, clocks.review, true);
  if ((reviewChanged && !compatibleReview) || identityChanged) {
    delete next.signal.approvers; delete next.signal.changeRequesters; delete next.signal.requestedReviewers;
    next.signal.reviewCommentCount = 0; delete next.signal.reviewCommentCounts;
    delete clocks.people; delete clocks.comments;
  }
  const incomingReviewMatches = reviewChanged || !incoming.observations && !previous.observations
    || observationsCompatible(incoming.observations?.people, clocks.review, true);
  if (incomingReviewMatches && accepts("people")) {
    for (const field of ["approvers", "changeRequesters", "requestedReviewers"] as const) {
      if (incoming.signal[field] !== undefined) next.signal[field] = incoming.signal[field];
    }
  }
  const commentsCompatible = !incoming.observations || observationsCompatible(incoming.observations?.comments, clocks.review, true);
  if (commentsCompatible && accepts("comments")) {
    next.signal.reviewCommentCount = incoming.signal.reviewCommentCount;
    if (incoming.signal.reviewCommentCounts !== undefined) next.signal.reviewCommentCounts = incoming.signal.reviewCommentCounts;
  }
  if (accepts("mergeability")) {
    next.mergeability = incoming.mergeability;
    next.attention = incoming.attention;
  }
  // Counts are an independent observation. Aggregate signals never invent them.
  if (incoming.checks && accepts("checkCounts")) next.checks = incoming.checks;
  if (next.checks && normalizePullRequestSignal({ checks: next.checks, review: next.signal.review }).checks !== next.signal.checks)
    next.checks = null;
  if (next.review && next.review.state !== next.signal.review) next.review = null;
  if (next.state === "merged" || previous.state === "merged" || incoming.state === "merged") {
    next.state = "merged"; next.draft = false; next.attention = "merged";
  } else if (next.state === "closed") next.attention = "closed";
  else if (next.state === "draft") next.attention = "draft";
  else if (next.attention !== "conflicts" && next.attention !== "queued") next.attention = pullRequestAttentionFromSignal(next.signal);
  if (previous.observations || incoming.observations) next.observations = clocks;
  if (retiredEpochs.size) next.retiredEpochs = [...retiredEpochs].slice(-8);
  return next;
}

export function mergePullRequestFacts(
  previous: PullRequestFactDirectory | undefined,
  incoming: readonly PullRequestFact[],
  threadFactKeys: Readonly<Record<string, string>> = {},
): PullRequestFactDirectory {
  const facts: Record<string, PullRequestFact> = {
    ...(previous?.facts ?? {}),
  };
  const observedAtByFact = { ...(previous?.observedAtByFact ?? {}) };
  for (const fact of incoming) {
    // Refreshing an existing fact moves it to the newest end of the bounded
    // directory. Object insertion order gives this cache a small, transparent
    // LRU without mirroring remote data in an interaction store.
    const existing = facts[fact.key];
    delete facts[fact.key];
    facts[fact.key] = mergePullRequestFact(existing, fact);
    const validation = observationValidationTime(facts[fact.key].observations);
    if (validation !== null) observedAtByFact[fact.key] = validation;
  }
  for (const key of Object.keys(facts).slice(0, -MAX_PULL_REQUEST_FACTS))
    delete facts[key];
  for (const key of Object.keys(observedAtByFact))
    if (!facts[key]) delete observedAtByFact[key];
  const nextThreadFactKeys = {
    ...(previous?.threadFactKeys ?? {}),
    ...threadFactKeys,
  };
  for (const [threadId, key] of Object.entries(nextThreadFactKeys))
    if (!facts[key]) delete nextThreadFactKeys[threadId];
  const nativeByFact = Object.fromEntries(Object.entries(previous?.nativeByFact ?? {}).filter(([key]) => Boolean(facts[key])));
  return { facts, threadFactKeys: nextThreadFactKeys, observedAtByFact, ...(Object.keys(nativeByFact).length ? { nativeByFact } : {}) };
}

/** Keyed native transitions are opaque; identical replay creates no occurrence. */
export function mergeNativePullRequestFact(directory: PullRequestFactDirectory | undefined, incoming: PullRequestFact) {
  const previousNative = directory?.nativeByFact?.[incoming.key];
  const groups = { ...previousNative?.groups };
  const observations: PullRequestObservations = {};
  const values = nativePullRequestGroupValues(incoming);
  const client = previousNative?.client ?? Math.random().toString(36).slice(2);
  for (const group of Object.keys(values) as (keyof typeof values)[]) {
    if (incoming.observations && incoming.observations[group]?.source !== "native") continue;
    const fingerprint = JSON.stringify([incoming.key, group, values[group]]);
    const oldGroup = groups[group];
    if (oldGroup?.fingerprint === fingerprint) continue;
    const native = { client, fingerprint, occurrence: (oldGroup?.occurrence ?? 0) + 1 };
    groups[group] = native;
    observations[group] = { ...incoming.observations?.[group], source: "native", validatedAt: null, native };
    if (group === "checks") observations.checkCounts = observations.checks;
  }
  if (Object.keys(observations).length === 0) return directory!;
  const merged = mergePullRequestFacts(directory, [{ ...incoming, observations }]);
  return { ...merged, nativeByFact: { ...merged.nativeByFact, [incoming.key]: { groups, client } } };
}

function nativePullRequestGroupValues(incoming: PullRequestFact) {
  return { title: incoming.title, lifecycle: [incoming.state, incoming.draft], head: incoming.head, base: incoming.base,
    checks: incoming.checks ? [incoming.checks.state, incoming.checks.totalCount, incoming.checks.passedCount, incoming.checks.failedCount, incoming.checks.pendingCount] : null,
    review: incoming.review ? [incoming.review.state, incoming.review.reviewRequestCount] : null,
    mergeability: [incoming.mergeability?.state ?? null, incoming.mergeability?.mergeable ?? null, incoming.mergeability?.mergeStateStatus ?? null, incoming.attention === "queued"] };
}

export function nativeValidationDemands(directory: PullRequestFactDirectory | undefined, key: string | null | undefined) {
  const groups = key ? directory?.nativeByFact?.[key]?.groups : undefined;
  return groups ? { checks: groups.checks, review: groups.review, mergeability: groups.mergeability } : undefined;
}

/**
 * Replace an explicit set of retained thread relationships atomically. Native
 * observers preserve unrelated references and remove only confirmed absence.
 * Facts and warm relationships remain bounded until Query garbage collection.
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
    ...(fact.observations ? { observations: fact.observations } : {}),
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
}>(fallback: T, facts: PullRequestFactDirectory | undefined): Omit<T, "state" | "draft"> & {
  state: PullRequestFact["state"];
  draft: boolean;
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
      draft: fallback.state === "draft",
      signal,
      attention: ("attention" in fallback
        ? (fallback.attention as string | null | undefined)
        : pullRequestAttentionFromSignal(signal)) ?? null,
    };
  }
  return {
    ...fallback,
    // A known merged fallback must survive even before its summary hydrates
    // the shared directory; a stale detailed OPEN fact cannot reopen a PR.
    state: fallback.state === "merged" ? "merged" : fact.state,
    draft: fallback.state === "merged" ? false : fact.draft,
    title: fact.title,
    url: fact.url,
    head: fact.head,
    base: fact.base,
    checks: pullRequestFromFact(fact).checks,
    review: pullRequestFromFact(fact).review,
    mergeability: pullRequestFromFact(fact).mergeability,
    ...(fact.observations ? { observations: fact.observations } : {}),
    signal: fact.signal,
    attention: fact.attention,
  };
}
