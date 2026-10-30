import type { GitHubStackBranch } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import { githubObservation, readObservedGitHub } from "./source-observation.js";
import { readSignalObservations, type SignalDemands } from "./signal-validation.js";
import { readRestChecks, earliestValidation } from "./rest-checks.js";
import type {
  GitHubApiRunner,
  GitHubPullRequest,
  GitHubSignal,
  ReviewCommentCounts,
} from "./server-types.js";

export const GITHUB_STACK_API_VERSION = "2026-03-10";
export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
// Changes polls an active PR as frequently as every 30 seconds. Keep this
// small server-side dedupe window below that cadence: otherwise a changed
// GitHub review decision can survive a successful Changes refresh and render
// as the previous state (for example, "Review pending" after approval).
export const GITHUB_SIGNAL_CACHE_MS = 20_000;
const GITHUB_GRAPHQL_BACKOFF_MS = 60 * 60_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`GitHub Stack response has invalid ${field}`);
  }
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw new Error(`GitHub Stack response has invalid ${field}`);
  }
  return value;
}

function requestedReviewerNames(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
  const names = value.nodes.flatMap((node) => {
    if (!isRecord(node) || !isRecord(node.requestedReviewer)) return [];
    const reviewer = node.requestedReviewer;
    if (typeof reviewer.login === "string" && reviewer.login) return [reviewer.login];
    if (typeof reviewer.slug === "string" && reviewer.slug) return [reviewer.slug];
    if (typeof reviewer.name === "string" && reviewer.name) return [reviewer.name];
    return [];
  });
  return [...new Set(names)];
}

/** Only user requests can clear a user's change request; a team is not them. */
function requestedReviewerLogins(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.nodes)) return [];
  return [...new Set(value.nodes.flatMap((node) => {
    if (!isRecord(node) || !isRecord(node.requestedReviewer)) return [];
    const login = node.requestedReviewer.login;
    return typeof login === "string" && login ? [login] : [];
  }))];
}

function restRequestedReviewerNames(pullRequest: Record<string, unknown>): string[] {
  const users = Array.isArray(pullRequest.requested_reviewers)
    ? pullRequest.requested_reviewers.flatMap((reviewer) =>
        isRecord(reviewer) && typeof reviewer.login === "string" && reviewer.login
          ? [reviewer.login]
          : [],
      )
    : [];
  const teams = Array.isArray(pullRequest.requested_teams)
    ? pullRequest.requested_teams.flatMap((team) => {
        if (!isRecord(team)) return [];
        if (typeof team.slug === "string" && team.slug) return [team.slug];
        if (typeof team.name === "string" && team.name) return [team.name];
        return [];
      })
    : [];
  return [...new Set([...users, ...teams])];
}

function restRequestedReviewerLogins(pullRequest: Record<string, unknown>): string[] {
  return Array.isArray(pullRequest.requested_reviewers)
    ? [...new Set(pullRequest.requested_reviewers.flatMap((reviewer) =>
        isRecord(reviewer) && typeof reviewer.login === "string" && reviewer.login
          ? [reviewer.login]
          : [],
      ))]
    : [];
}

type ReviewSource = "graphql" | "rest";

function reviewerIdentity(value: string) {
  return value.trim().toLowerCase();
}

function flattenRestReviewPages(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    Array.isArray(entry) ? flattenRestReviewPages(entry) : [entry],
  );
}

/**
 * Returns the latest review decision per person. COMMENTED reviews do not
 * clear an earlier approval or change request; only a later decisive review
 * (or dismissal) can do that.
 */
function latestReviewerDecisions(value: unknown, source: ReviewSource) {
  const reviews = source === "graphql"
    ? isRecord(value) && Array.isArray(value.nodes) ? value.nodes : []
    : flattenRestReviewPages(value);
  const latest = new Map<string, { state: string; submittedAt: number }>();
  for (const review of reviews) {
    if (!isRecord(review)) continue;
    const author = source === "graphql" ? review.author : review.user;
    const login = isRecord(author) && typeof author.login === "string"
      ? author.login
      : null;
    if (!login || typeof review.state !== "string") continue;
    if (!new Set(["APPROVED", "CHANGES_REQUESTED", "DISMISSED"]).has(review.state))
      continue;
    const submitted = source === "graphql" ? review.submittedAt : review.submitted_at;
    const submittedAt = typeof submitted === "string" ? Date.parse(submitted) : 0;
    const previous = latest.get(login);
    if (!previous || submittedAt >= previous.submittedAt)
      latest.set(login, { state: review.state, submittedAt });
  }
  return new Map([...latest].map(([login, review]) => [login, review.state]));
}

function reviewersWithState(
  reviewerStates: ReadonlyMap<string, string>,
  state: "APPROVED" | "CHANGES_REQUESTED",
) {
  return [...reviewerStates]
    .filter(([, reviewerState]) => reviewerState === state)
    .map(([reviewer]) => reviewer)
    .sort((left, right) => left.localeCompare(right));
}

function reviewerFacts(reviewerStates: ReadonlyMap<string, string>) {
  return {
    approvers: reviewersWithState(reviewerStates, "APPROVED"),
    changeRequesters: reviewersWithState(reviewerStates, "CHANGES_REQUESTED"),
  };
}

/**
 * A change request becomes a re-request only when every reviewer currently
 * blocking with changes is explicitly requested again. A bare request count
 * is insufficient: it may name somebody else or a team.
 */
export function resolveReviewState({
  reviewDecision,
  requestedReviewers,
  reviewerStates,
}: {
  reviewDecision: string;
  requestedReviewers: readonly string[];
  reviewerStates: ReadonlyMap<string, string>;
}): GitHubSignal["review"] {
  const changeRequesters = reviewersWithState(reviewerStates, "CHANGES_REQUESTED");
  // GitHub logins are case-insensitive. Keep the matching strict to the same
  // identity while avoiding a casing difference between review and request
  // payloads leaving an already re-requested reviewer as blocking.
  const requested = new Set(requestedReviewers.map(reviewerIdentity));
  const reRequested =
    changeRequesters.length > 0 &&
    changeRequesters.every((reviewer) => requested.has(reviewerIdentity(reviewer)));
  // GitHub's aggregate decision is authoritative when it is present. In
  // particular, an approved PR may retain historical change-request reviews;
  // those must not turn an APPROVED decision back into a pending row.
  if (reviewDecision === "APPROVED") return "approved";
  if (reviewDecision === "CHANGES_REQUESTED" || changeRequesters.length > 0)
    return reRequested ? "review_required" : "changes_requested";
  if ([...reviewerStates.values()].includes("APPROVED"))
    return "approved";
  if (requested.size > 0) return "review_requested";
  return reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
}

export function githubStackApiArgs(owner: string, repo: string, pullRequest: number): string[] {
  return [
    "api", "--method", "GET", `repos/${owner}/${repo}/stacks`,
    "-f", `pull_request=${pullRequest}`,
    "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
    "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
  ];
}

export function githubStacksApiArgs(owner: string, repo: string): string[] {
  return [
    "api", "--method", "GET", `repos/${owner}/${repo}/stacks`,
    "-f", "per_page=100",
    "--paginate", "--slurp",
    "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
    "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
  ];
}

function parseStackPullRequest(value: unknown): GitHubPullRequest {
  if (!isRecord(value)) throw new Error("GitHub Stack response has an invalid pull request");
  const head = isRecord(value.head) ? value.head.ref : undefined;
  const base = isRecord(value.base) ? value.base.ref : undefined;
  const state = requiredString(value.state, "pull request state").toLowerCase();
  if (state !== "open" && state !== "closed" && state !== "merged" && state !== "draft")
    throw new Error("GitHub Stack response has an invalid pull request state");
  const observation = githubObservation(value, null);
  return {
    observations: {
      ...(typeof value.title === "string" || value.title === null ? { title: observation } : {}),
      ...(state !== "open" || typeof value.draft === "boolean" ? { lifecycle: observation } : {}),
      ...(typeof head === "string" || value.head === null ? { head: observation } : {}),
      ...(typeof base === "string" || value.base === null ? { base: observation } : {}),
      ...(typeof value.review_comments === "number" ? { comments: observation } : {}),
    },
    number: requiredNumber(value.number, "pull request number"),
    state,
    draft: value.draft === true,
    head: typeof head === "string" ? head : "",
    base: typeof base === "string" ? base : "",
    title: typeof value.title === "string" ? value.title.trim() : "",
    url: typeof value.html_url === "string" ? value.html_url : "",
    reviewCommentCount: typeof value.review_comments === "number" && Number.isFinite(value.review_comments) ? value.review_comments : 0,
  };
}

export function needsGitHubPullRequestRecovery(pullRequest: GitHubPullRequest) {
  return !pullRequest.title || !pullRequest.url || !pullRequest.head || !pullRequest.base;
}

export function parseGitHubStacksResponse(value: unknown): Array<{ number: number; base: string; pullRequests: GitHubPullRequest[] }> {
  const response = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.stacks)
      ? value.stacks
      : [value];
  const candidates = response.every(Array.isArray) ? response.flat() : response;
  return candidates.map((candidate) => {
    if (!isRecord(candidate))
      throw new Error("GitHub Stack response contains an invalid stack");
    const base = isRecord(candidate.base) ? candidate.base.ref : undefined;
    if (!Array.isArray(candidate.pull_requests))
      throw new Error("GitHub Stack response is missing pull_requests");
    return {
      number: requiredNumber(candidate.number, "stack number"),
      base: requiredString(base, "stack base"),
      pullRequests: candidate.pull_requests.map(parseStackPullRequest),
    };
  });
}

export function parseGitHubStackResponse(value: unknown): { number: number; base: string; pullRequests: GitHubPullRequest[] } | null {
  return parseGitHubStacksResponse(value)[0] ?? null;
}

export async function readGitHubPullRequestDiff(
  owner: string,
  repo: string,
  pullRequest: number,
  run: GitHubApiRunner,
): Promise<NonNullable<GitHubStackBranch["diff"]>> {
  const raw: unknown = JSON.parse(await run(githubPullRequestFilesApiArgs(
    owner,
    repo,
    pullRequest,
  ), 4_000_000));
  if (!Array.isArray(raw)) throw new Error("GitHub pull request files response is invalid");
  const files = raw.map((value) => {
    if (!isRecord(value)) throw new Error("GitHub pull request files response contains an invalid file");
    const remoteStatus = requiredString(value.status, "pull request file status");
    const status = remoteStatus === "added"
      ? "added"
      : remoteStatus === "removed"
        ? "deleted"
        : remoteStatus === "renamed"
          ? "renamed"
          : "modified";
    return {
      path: requiredString(value.filename, "pull request file path"),
      previousPath: typeof value.previous_filename === "string" ? value.previous_filename : null,
      status,
      additions: typeof value.additions === "number" ? value.additions : null,
      deletions: typeof value.deletions === "number" ? value.deletions : null,
    } satisfies NonNullable<GitHubStackBranch["diff"]>["files"][number];
  });
  return {
    additions: files.reduce((total, file) => total + (file.additions ?? 0), 0),
    deletions: files.reduce((total, file) => total + (file.deletions ?? 0), 0),
    files,
    truncated: files.length === 100,
  };
}

function githubPullRequestFilesApiArgs(
  owner: string,
  repo: string,
  pullRequest: number,
): string[] {
  return [
    "api",
    "--method",
    "GET",
    `repos/${owner}/${repo}/pulls/${pullRequest}/files?per_page=100`,
    "-H",
    `Accept: ${GITHUB_ACCEPT_HEADER}`,
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
  ];
}

export async function readGitHubPullRequestFilePatch(
  owner: string,
  repo: string,
  pullRequest: number,
  path: string,
  run: GitHubApiRunner,
): Promise<
  | { kind: "patch"; path: string; patch: string; message: null }
  | { kind: "absent"; path: string; patch: null; message: string }
> {
  const raw: unknown = JSON.parse(
    await run(githubPullRequestFilesApiArgs(owner, repo, pullRequest), 4_000_000),
  );
  if (!Array.isArray(raw)) throw new Error("GitHub pull request files response is invalid");
  const file = raw.find(
    (value) => isRecord(value) && value.filename === path,
  );
  if (!file)
    return {
      kind: "absent",
      path,
      patch: null,
      message: "This file is no longer part of the pull request.",
    };
  if (typeof file.patch !== "string" || !file.patch)
    return {
      kind: "absent",
      path,
      patch: null,
      message: "GitHub did not provide a text diff for this file.",
    };
  return { kind: "patch", path, patch: file.patch, message: null };
}

function signalFromGraphql(value: unknown, validatedAt: number | null = null): GitHubSignal | null {
  if (!isRecord(value)) return null;
  const graphqlReviews = isRecord(value.reviews) ? value.reviews : null;
  // GitHub caps a GraphQL connection at 100. Do not guess a reviewer's
  // current decision from a truncated history: REST pagination is slower but
  // complete, and is needed only for exceptionally review-heavy PRs.
  if (
    graphqlReviews &&
    typeof graphqlReviews.totalCount === "number" &&
    Array.isArray(graphqlReviews.nodes) &&
    graphqlReviews.totalCount > graphqlReviews.nodes.length
  )
    return null;
  const reviewDecision = String(value.reviewDecision ?? "");
  const requestedReviewers = requestedReviewerNames(value.reviewRequests);
  const requestedReviewerUsers = requestedReviewerLogins(value.reviewRequests);
  const reviewerStates = latestReviewerDecisions(value.reviews, "graphql");
  const review = resolveReviewState({
    reviewDecision,
    requestedReviewers: requestedReviewerUsers,
    reviewerStates,
  });
  const reviewerFact = reviewerFacts(reviewerStates);
  const hasReviewPeople = Boolean(graphqlReviews && Array.isArray(graphqlReviews.nodes));
  const hasReviewRequests = isRecord(value.reviewRequests) && Array.isArray(value.reviewRequests.nodes);
  const hasChecks = isRecord(value.commits) && Array.isArray(value.commits.nodes);
  const hasReview = Object.hasOwn(value, "reviewDecision") || hasReviewPeople || hasReviewRequests;
  if (!hasChecks && !hasReview) return null;
  const observation = { ...githubObservation(value, validatedAt),
    reviewIdentity: JSON.stringify([reviewDecision, value.reviews ?? null, value.reviewRequests ?? null]) };
  const mergeable = value.mergeable === "CONFLICTING" || value.mergeable === "MERGEABLE" || value.mergeable === "UNKNOWN" ? value.mergeable : null;
  const mergeStateStatus = typeof value.mergeStateStatus === "string" ? value.mergeStateStatus : null;
  const conflicts = mergeable === "CONFLICTING" || mergeStateStatus === "DIRTY";
  const mergeabilityState = conflicts ? "conflicts" as const : value.isDraft === true ? "draft" as const
    : ["BLOCKED", "BEHIND", "HAS_HOOKS"].includes(mergeStateStatus ?? "") ? "blocked" as const
      : mergeable === "MERGEABLE" || mergeStateStatus === "CLEAN" ? "mergeable" as const : "unknown" as const;
  const commits = isRecord(value.commits) && Array.isArray(value.commits.nodes) ? value.commits.nodes : [];
  const commit = commits[commits.length - 1];
  const rollup = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.statusCheckRollup)
    ? commit.commit.statusCheckRollup : null;
  const state = String(rollup?.state ?? "");
  const checks = state === "SUCCESS" ? "passing"
    : state === "FAILURE" || state === "ERROR" ? "failed"
      : state ? "pending" : "none";
  const head = typeof value.headRefName === "string" && value.headRefName ? value.headRefName : null;
  const base = typeof value.baseRefName === "string" && value.baseRefName ? value.baseRefName : null;
  return {
    observations: {
      ...(hasChecks ? { checks: observation } : {}), ...(hasReview ? { review: observation } : {}),
      ...(hasReviewPeople || hasReviewRequests ? { people: observation } : {}),
      ...(typeof value.title === "string" ? { title: observation } : {}),
      ...(typeof value.state === "string" && typeof value.isDraft === "boolean" ? { lifecycle: observation } : {}),
      ...(head ? { head: observation } : {}), ...(base ? { base: observation } : {}),
      ...(mergeable !== null || mergeStateStatus !== null ? { mergeability: observation } : {}),
    },
    ...(typeof value.title === "string" ? { title: value.title } : {}),
    ...(typeof value.url === "string" ? { url: value.url } : {}),
    ...(typeof value.state === "string" ? { state: value.state === "MERGED" ? "merged" as const
      : value.state === "CLOSED" ? "closed" as const : value.isDraft === true ? "draft" as const : "open" as const,
      draft: value.isDraft === true } : {}),
    checks,
    review,
    ...(isRecord(value.reviewRequests) && typeof value.reviewRequests.totalCount === "number" ? { reviewRequestCount: value.reviewRequests.totalCount } : {}),
    ...(hasReviewPeople ? { approvers: reviewerFact.approvers, changeRequesters: reviewerFact.changeRequesters } : {}),
    ...(hasReviewRequests ? { requestedReviewers } : {}),
    ...(mergeable !== null || mergeStateStatus !== null ? { mergeability: {
      state: mergeabilityState,
      mergeable, mergeStateStatus: mergeStateStatus as import("./server-types.js").CurrentPullRequest["mergeability"]["mergeStateStatus"],
    }, attention: conflicts ? "conflicts" as const : value.isInMergeQueue === true ? "queued" as const : "none" as const } : {}),
    ...(head ? { head } : {}),
    ...(base ? { base } : {}),
  };
}

function reviewCommentCountsFromGraphql(value: unknown): ReviewCommentCounts | null {
  if (!isRecord(value) || !isRecord(value.reviewThreads)) return null;
  const reviewThreads = value.reviewThreads;
  if (
    typeof reviewThreads.totalCount !== "number" ||
    !Number.isInteger(reviewThreads.totalCount) ||
    !Array.isArray(reviewThreads.nodes) ||
    reviewThreads.totalCount !== reviewThreads.nodes.length
  )
    return null;
  const counts: ReviewCommentCounts = { unresolved: 0, resolved: 0 };
  for (const thread of reviewThreads.nodes) {
    if (
      !isRecord(thread) ||
      typeof thread.isResolved !== "boolean" ||
      !isRecord(thread.comments) ||
      typeof thread.comments.totalCount !== "number" ||
      !Number.isInteger(thread.comments.totalCount) ||
      thread.comments.totalCount < 0
    )
      return null;
    counts[thread.isResolved ? "resolved" : "unresolved"] +=
      thread.comments.totalCount;
  }
  return counts;
}

/**
 * Resolution is a review-thread property in GitHub GraphQL. REST exposes only
 * the aggregate review-comment total, so incomplete GraphQL connections are
 * omitted and the caller retains that aggregate fallback.
 */
export async function readGitHubReviewCommentCounts(
  owner: string,
  repo: string,
  numbers: readonly number[],
  run: GitHubApiRunner,
): Promise<Map<number, ReviewCommentCounts>> {
  const observed = await readGitHubReviewCommentObservations(owner, repo, numbers, run);
  return new Map([...observed].map(([number, value]) => [number, value.counts]));
}

export async function readGitHubReviewCommentObservations(
  owner: string, repo: string, numbers: readonly number[], run: GitHubApiRunner, epoch?: string,
): Promise<Map<number, { counts: ReviewCommentCounts; observation: import("./schemas.js").PullRequestObservation }>> {
  const unique = [...new Set(numbers)].filter(
    (number) => Number.isInteger(number) && number > 0,
  );
  if (unique.length === 0) return new Map();
  const selections = unique
    .map(
      (number, index) =>
        [
          `p${index}: pullRequest(number: ${number}) { headRefOid baseRefOid updatedAt reviewDecision`,
          "reviewRequests(first: 100) { totalCount nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }",
          "reviews(last: 100) { totalCount nodes { author { login } state submittedAt } }",
          "reviewThreads(first: 100) { totalCount nodes { isResolved comments { totalCount } } } }",
        ].join(" "),
    )
    .join(" ");
  try {
    const source = await readObservedGitHub(run,
      [
        "api",
        "graphql",
        "-f",
        `query=query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${selections} } }`,
      ],
      2_000_000,
    );
    const parsed: unknown = JSON.parse(source.text);
    const repository =
      isRecord(parsed) && isRecord(parsed.data) && isRecord(parsed.data.repository)
        ? parsed.data.repository
        : {};
    const result = new Map<number, { counts: ReviewCommentCounts; observation: import("./schemas.js").PullRequestObservation }>();
    unique.forEach((number, index) => {
      const value = repository[`p${index}`];
      const counts = reviewCommentCountsFromGraphql(value);
      if (counts && isRecord(value)) result.set(number, { counts, observation: { ...githubObservation(value, source.validatedAt),
        ...(source.sequence === undefined ? {} : { sequence: source.sequence }), ...(epoch === undefined ? {} : { epoch }),
        reviewIdentity: JSON.stringify([String(value.reviewDecision ?? ""), value.reviews ?? null, value.reviewRequests ?? null]) } });
    });
    return result;
  } catch {
    return new Map();
  }
}

function signalKey(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

export type GitHubRestPullRequest = {
  pullRequest: GitHubPullRequest;
  signal: GitHubSignal;
  checks: {
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
    totalCount: number;
  };
  reviewRequestCount: number;
};

function graphQlRateLimited(error: unknown) {
  return /graphql_rate_limit|API rate limit already exceeded|secondary rate limit/i.test(error instanceof Error ? error.message : String(error));
}

export async function readGitHubSignals(
  owner: string,
  repo: string,
  numbers: readonly number[],
  lifecycle: ServerLifecycle,
  run: GitHubApiRunner,
  requirements: Readonly<Record<number, SignalDemands>> = {},
  receivedSequence?: number,
): Promise<Map<number, GitHubSignal>> {
  return readSignalObservations({ owner, repo, numbers, lifecycle, demands: requirements, receivedSequence,
    canValidate: (group) => group !== "mergeability" || Date.now() >= lifecycle.githubGraphqlBackoffUntil,
    load: async (missing, afterSequence) => {
      const revision = lifecycle.remoteGeneration(`${owner}/${repo}`);
      const assertCurrent = () => { if (revision !== lifecycle.remoteGeneration(`${owner}/${repo}`) || lifecycle.isDisposed) throw new Error("GitHub signals changed during the read."); };
      const signals = new Map<number, GitHubSignal>();
      if (Date.now() >= lifecycle.githubGraphqlBackoffUntil) {
        const selections = missing.map((number, index) => [
          `p${index}: pullRequest(number: ${number}) {`,
          "title url state isDraft updatedAt headRefName baseRefName headRefOid baseRefOid reviewDecision mergeable mergeStateStatus isInMergeQueue",
          "reviewRequests(first: 100) { totalCount nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }",
          "reviews(last: 100) { totalCount nodes { author { login } state submittedAt } }",
          "commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }",
          "}",
        ].join(" ")).join(" ");
        try {
          const observed = await readObservedGitHub(run, ["api", "graphql", "-f", `query=query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${selections} } }`], 4_000_000, afterSequence);
          assertCurrent();
          const parsed: unknown = JSON.parse(observed.text);
          const repository = isRecord(parsed) && isRecord(parsed.data) && isRecord(parsed.data.repository) ? parsed.data.repository : {};
          missing.forEach((number, index) => {
            const signal = signalFromGraphql(repository[`p${index}`], observed.validatedAt);
            if (!signal) return;
            signal.observations = Object.fromEntries(Object.entries(signal.observations ?? {}).map(([group, clock]) =>
              [group, { ...clock, ...(observed.sequence === undefined ? {} : { sequence: observed.sequence }), epoch: lifecycle.observationEpoch }]));
            signals.set(number, signal);
          });
        } catch (error) {
          assertCurrent();
          if (graphQlRateLimited(error)) lifecycle.githubGraphqlBackoffUntil = Date.now() + GITHUB_GRAPHQL_BACKOFF_MS;
        }
      }
      const fallback = await Promise.all(missing.filter((number) => !signals.has(number)).map(async (number) => {
        const recovered = await readGitHubPullRequestRest(owner, repo, number, lifecycle, run, afterSequence);
        return [number, recovered?.signal ?? null] as const;
      }));
      assertCurrent();
      for (const [number, signal] of fallback) if (signal) signals.set(number, signal);
      return signals;
    },
  });
}

export async function readGitHubPullRequestRest(
  owner: string,
  repo: string,
  number: number,
  lifecycle: ServerLifecycle,
  run: GitHubApiRunner,
  afterSequence?: number,
): Promise<GitHubRestPullRequest | null> {
  const revision = lifecycle.remoteGeneration(`${owner}/${repo}`);
  try {
    const headers = ["-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`];
    const [metadataRead, reviewsRead] = await Promise.all([
      readObservedGitHub(run, ["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, ...headers], 2_000_000, afterSequence),
      readObservedGitHub(run, ["api", "--method", "GET", "--paginate", "--slurp", `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, ...headers], 2_000_000, afterSequence),
    ]);
    const pullRequest = JSON.parse(metadataRead.text) as unknown;
    const reviews = JSON.parse(reviewsRead.text) as unknown;
    if (!isRecord(pullRequest)) return null;
    const head = isRecord(pullRequest.head) && typeof pullRequest.head.ref === "string" && pullRequest.head.ref
      ? pullRequest.head.ref : null;
    const base = isRecord(pullRequest.base) && typeof pullRequest.base.ref === "string" && pullRequest.base.ref
      ? pullRequest.base.ref : null;
    const requestedReviewerList = restRequestedReviewerNames(pullRequest);
    const requestedReviewerUsers = restRequestedReviewerLogins(pullRequest);
    const metadata = {
      ...(head ? { head } : {}),
      ...(base ? { base } : {}),
      ...(requestedReviewerList.length ? { requestedReviewers: requestedReviewerList } : {}),
    };
    const requestedReviewers = Array.isArray(pullRequest.requested_reviewers)
      ? pullRequest.requested_reviewers.length
      : 0;
    const requestedTeams = Array.isArray(pullRequest.requested_teams)
      ? pullRequest.requested_teams.length
      : 0;
    const requests = requestedReviewers + requestedTeams;
    const reviewerStates = latestReviewerDecisions(reviews, "rest");
    const review = resolveReviewState({
      reviewDecision: "",
      requestedReviewers: requestedReviewerUsers,
      reviewerStates,
    });
    const reviewerFact = reviewerFacts(reviewerStates);
    const metadataIdentity = { ...githubObservation(pullRequest, metadataRead.validatedAt), epoch: lifecycle.observationEpoch };
    const metadataObservation = { ...metadataIdentity, ...(metadataRead.sequence === undefined ? {} : { sequence: metadataRead.sequence }) };
    const reviewObservation = { ...metadataIdentity, ...earliestValidation([metadataRead, reviewsRead]),
      reviewIdentity: JSON.stringify([reviews, pullRequest.requested_reviewers ?? null, pullRequest.requested_teams ?? null]) };
    const observations = {
      ...(typeof pullRequest.title === "string" || pullRequest.title === null ? { title: metadataObservation } : {}),
      ...(typeof pullRequest.state === "string" && typeof pullRequest.draft === "boolean" ? { lifecycle: metadataObservation } : {}),
      ...(head || pullRequest.head === null ? { head: metadataObservation } : {}),
      ...(base || pullRequest.base === null ? { base: metadataObservation } : {}),
      review: reviewObservation, people: reviewObservation,
      ...(typeof pullRequest.review_comments === "number" || pullRequest.review_comments === null ? { comments: { ...metadataObservation, reviewIdentity: reviewObservation.reviewIdentity } } : {}),
    };
    const sha = isRecord(pullRequest.head) && typeof pullRequest.head.sha === "string" ? pullRequest.head.sha : null;
    const recoveredPullRequest: GitHubPullRequest = {
      observations,
      number,
      state: pullRequest.merged === true ? "merged" : pullRequest.state === "closed" ? "closed" : "open",
      draft: pullRequest.draft === true,
      head: head ?? "",
      base: base ?? "",
      title: typeof pullRequest.title === "string" ? pullRequest.title.trim() : "",
      url: typeof pullRequest.html_url === "string" ? pullRequest.html_url : `https://github.com/${owner}/${repo}/pull/${number}`,
      reviewCommentCount: typeof pullRequest.review_comments === "number" && Number.isFinite(pullRequest.review_comments) ? pullRequest.review_comments : 0,
    };
    if (!sha) {
      const signal = {
        observations,
        checks: "unknown",
        review,
        approvers: reviewerFact.approvers,
        changeRequesters: reviewerFact.changeRequesters,
        requestedReviewers: requestedReviewerList,
        reviewRequestCount: requests,
        ...metadata,
      } satisfies GitHubSignal;
      return {
        pullRequest: recoveredPullRequest,
        signal,
        checks: { failedCount: 0, passedCount: 0, pendingCount: 0, state: "unknown", totalCount: 0 },
        reviewRequestCount: requests,
      };
    }
    const checksRead = await readRestChecks({ owner, repo, sha, run, headers, afterSequence });
    // Cached SHA-scoped checks may precede the initial metadata admission.
    // That metadata already guards their head/base; forcing it again on every
    // semantic-cache expiry spends a REST request without observing new inputs.
    // Unknown admission order still needs the conservative trailing read.
    const metadataFollowsChecks = metadataRead.sequence !== undefined && checksRead.sources.every((source) =>
      source.sequence !== undefined && source.sequence < metadataRead.sequence!);
    const trailingMetadata = metadataFollowsChecks ? metadataRead : await readObservedGitHub(run,
      ["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, ...headers], 2_000_000,
      lifecycle.nextObservationSequence());
    const trailing = JSON.parse(trailingMetadata.text) as unknown;
    if (!isRecord(trailing) || !isRecord(trailing.head) || trailing.head.sha !== sha
      || !isRecord(trailing.base) || !isRecord(pullRequest.base)
      || trailing.base.sha !== pullRequest.base.sha || trailing.base.ref !== pullRequest.base.ref)
      throw new Error("Pull request head/base changed during checks validation.");
    const validation = earliestValidation([metadataRead, ...checksRead.sources, trailingMetadata]);
    const reviewValidation = earliestValidation([metadataRead, reviewsRead, trailingMetadata]);
    const checks = checksRead.checks;
    const signalChecks = checks.state === "failing" ? "failed" : checks.state === "no_checks" ? "none" : checks.state;
    // Composite evidence cannot inherit a metadata-only sequence when any
    // contributing read has no sequence. Omit it rather than certify that read.
    const checkedObservation = { ...metadataIdentity, ...validation };
    const checkedReviewObservation = { ...metadataIdentity, ...reviewValidation, reviewIdentity: reviewObservation.reviewIdentity };
    if (typeof trailing.review_comments === "number") {
      recoveredPullRequest.reviewCommentCount = trailing.review_comments;
      observations.comments = { ...metadataIdentity, validatedAt: trailingMetadata.validatedAt,
        ...(trailingMetadata.sequence === undefined ? {} : { sequence: trailingMetadata.sequence }), reviewIdentity: reviewObservation.reviewIdentity };
    }

    const signal = {
      observations: { ...observations, checks: checkedObservation, checkCounts: checkedObservation, review: checkedReviewObservation, people: checkedReviewObservation },
      checks: signalChecks,
      review,
      approvers: reviewerFact.approvers,
      changeRequesters: reviewerFact.changeRequesters,
      requestedReviewers: requestedReviewerList,
      reviewRequestCount: requests,
      checkDetails: checks,
      ...metadata,
    } satisfies GitHubSignal;
    if (revision !== lifecycle.remoteGeneration(`${owner}/${repo}`) || lifecycle.isDisposed) throw new Error("GitHub signals changed during the read.");
    return {
      pullRequest: recoveredPullRequest,
      signal,
      checks,
      reviewRequestCount: requests,
    };
  } catch {
    return null;
  }
}

export async function fetchGitHubStack(
  owner: string,
  repo: string,
  pullRequest: number,
  run: GitHubApiRunner,
  lifecycle: ServerLifecycle,
  discovered?: ReturnType<typeof parseGitHubStackResponse>,
  requirements: Readonly<Record<number, SignalDemands>> = {},
): Promise<{ number: number; base: string; currentPullRequest: number; pullRequests: Array<GitHubPullRequest & GitHubSignal> } | null> {
  const source = discovered === undefined ? await readObservedGitHub(run, githubStackApiArgs(owner, repo, pullRequest), 4_000_000) : null;
  const raw = source ? parseGitHubStackResponse(JSON.parse(source.text)) : discovered;
  if (source && raw) raw.pullRequests = raw.pullRequests.map((member) => ({ ...member,
    observations: Object.fromEntries(Object.entries(member.observations ?? {}).map(([group, clock]) => [group,
      { ...clock, validatedAt: source.validatedAt, ...(source.sequence === undefined ? {} : { sequence: source.sequence }), epoch: lifecycle.observationEpoch }])) }));
  if (!raw) return null;
  const pullRequests = await Promise.all(raw.pullRequests.map(async (item) => {
    if (!needsGitHubPullRequestRecovery(item)) return item;
    const recovered = await readGitHubPullRequestRest(owner, repo, item.number, lifecycle, run);
    if (!recovered) return { ...item, url: item.url || `https://github.com/${owner}/${repo}/pull/${item.number}` };
    lifecycle.cacheGitHubPullRequestSignal(signalKey(owner, repo, item.number), recovered.signal, Date.now() + GITHUB_SIGNAL_CACHE_MS);
    return { ...item, ...recovered.pullRequest };
  }));
  const numbers = pullRequests.map((item) => item.number);
  const [signals, reviewCommentCounts] = await Promise.all([
    readGitHubSignals(owner, repo, numbers, lifecycle, run, requirements),
    readGitHubReviewCommentObservations(owner, repo, numbers, run, lifecycle.observationEpoch),
  ]);
  return {
    number: raw.number,
    base: raw.base,
    currentPullRequest: pullRequest,
    pullRequests: pullRequests.map((item) => {
      const counts = reviewCommentCounts.get(item.number);
      return {
        ...item,
        ...(signals.get(item.number) ?? { checks: "unknown", review: "none" }),
        observations: { ...item.observations, ...signals.get(item.number)?.observations },
        ...(counts ? { reviewCommentCounts: counts.counts, reviewCommentCount: counts.counts.unresolved + counts.counts.resolved } : {}),
        ...(counts ? { observations: { ...item.observations, ...signals.get(item.number)?.observations, comments: counts.observation } } : {}),
      };
    }),
  };
}
