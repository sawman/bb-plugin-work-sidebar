import type { GitHubStackBranch } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { GitHubApiRunner, GitHubPullRequest, GitHubSignal } from "./server-types.js";

export const GITHUB_STACK_API_VERSION = "2026-03-10";
export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
const GITHUB_SIGNAL_CACHE_MS = 2 * 60_000;
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
  if (reviewDecision === "CHANGES_REQUESTED" || changeRequesters.length > 0)
    return reRequested ? "review_required" : "changes_requested";
  if (reviewDecision === "APPROVED" || [...reviewerStates.values()].includes("APPROVED"))
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
  return {
    number: requiredNumber(value.number, "pull request number"),
    state: requiredString(value.state, "pull request state"),
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

function signalFromGraphql(value: unknown): GitHubSignal | null {
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
    checks,
    review,
    ...(reviewerFact.approvers.length
      ? { approvers: reviewerFact.approvers }
      : {}),
    ...(reviewerFact.changeRequesters.length
      ? { changeRequesters: reviewerFact.changeRequesters }
      : {}),
    ...(requestedReviewers.length ? { requestedReviewers } : {}),
    ...(head ? { head } : {}),
    ...(base ? { base } : {}),
  };
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
): Promise<Map<number, GitHubSignal>> {
  const unique = [...new Set(numbers)].filter((number) => Number.isInteger(number) && number > 0);
  const signals = new Map<number, GitHubSignal>();
  const missing: number[] = [];
  for (const number of unique) {
    const cached = lifecycle.githubPullRequestSignalCache.get(signalKey(owner, repo, number));
    if (cached && cached.expiresAt > Date.now()) signals.set(number, cached.value);
    else missing.push(number);
  }
  if (missing.length && Date.now() >= lifecycle.githubGraphqlBackoffUntil) {
    const selections = missing
      .map((number, index) =>
        [
          `p${index}: pullRequest(number: ${number}) {`,
          "headRefName baseRefName reviewDecision",
          "reviewRequests(first: 100) { totalCount nodes { requestedReviewer { ... on User { login } ... on Team { slug } } } }",
          "reviews(last: 100) { totalCount nodes { author { login } state submittedAt } }",
          "commits(last: 1) { nodes { commit { statusCheckRollup { state } } } }",
          "}",
        ].join(" "),
      )
      .join(" ");
    try {
      const stdout = await run(["api", "graphql", "-f", `query=query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${selections} } }`], 4_000_000);
      const parsed: unknown = JSON.parse(stdout);
      const repository = isRecord(parsed) && isRecord(parsed.data) && isRecord(parsed.data.repository) ? parsed.data.repository : {};
      missing.forEach((number, index) => {
        const signal = signalFromGraphql(repository[`p${index}`]);
        if (!signal) return;
        signals.set(number, signal);
        lifecycle.cacheGitHubPullRequestSignal(signalKey(owner, repo, number), signal, Date.now() + GITHUB_SIGNAL_CACHE_MS);
      });
    } catch (error) {
      if (graphQlRateLimited(error)) lifecycle.githubGraphqlBackoffUntil = Date.now() + GITHUB_GRAPHQL_BACKOFF_MS;
    }
  }
  const fallback = await Promise.all(missing.filter((number) => !signals.has(number)).map(async (number) => {
    const key = signalKey(owner, repo, number);
    const pending = lifecycle.githubPullRequestSignalPending.get(key);
    if (pending) return [number, await pending] as const;
    const request = readGitHubPullRequestRest(owner, repo, number, lifecycle, run)
      .then((recovered) => recovered?.signal ?? null)
      .finally(() => lifecycle.releasePending("pullRequestSignal", key));
    lifecycle.githubPullRequestSignalPending.set(key, request);
    return [number, await request] as const;
  }));
  for (const [number, signal] of fallback) {
    if (signal) signals.set(number, signal);
  }
  return signals;
}

export async function readGitHubPullRequestRest(
  owner: string,
  repo: string,
  number: number,
  lifecycle: ServerLifecycle,
  run: GitHubApiRunner,
): Promise<GitHubRestPullRequest | null> {
  try {
    const headers = ["-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`];
    const [pullRequestText, reviewsText] = await Promise.all([
      run(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, ...headers], 2_000_000),
      run(["api", "--method", "GET", "--paginate", "--slurp", `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, ...headers], 2_000_000),
    ]);
    const pullRequest = JSON.parse(pullRequestText) as unknown;
    const reviews = JSON.parse(reviewsText) as unknown;
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
    const sha = isRecord(pullRequest.head) && typeof pullRequest.head.sha === "string" ? pullRequest.head.sha : null;
    const recoveredPullRequest: GitHubPullRequest = {
      number,
      state: pullRequest.merged === true ? "merged" : typeof pullRequest.state === "string" ? pullRequest.state : "open",
      draft: pullRequest.draft === true,
      head: head ?? "",
      base: base ?? "",
      title: typeof pullRequest.title === "string" ? pullRequest.title.trim() : "",
      url: typeof pullRequest.html_url === "string" ? pullRequest.html_url : `https://github.com/${owner}/${repo}/pull/${number}`,
      reviewCommentCount: typeof pullRequest.review_comments === "number" && Number.isFinite(pullRequest.review_comments) ? pullRequest.review_comments : 0,
    };
    if (!sha) {
      const signal = {
        checks: "unknown",
        review,
        ...(reviewerFact.approvers.length
          ? { approvers: reviewerFact.approvers }
          : {}),
        ...(reviewerFact.changeRequesters.length
          ? { changeRequesters: reviewerFact.changeRequesters }
          : {}),
        ...metadata,
      } satisfies GitHubSignal;
      return {
        pullRequest: recoveredPullRequest,
        signal,
        checks: { failedCount: 0, passedCount: 0, pendingCount: 0, state: "unknown", totalCount: 0 },
        reviewRequestCount: requests,
      };
    }
    const checks = JSON.parse(await run([
      "api", "--method", "GET", `repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
      ...headers,
    ], 4_000_000)) as unknown;
    const runs = isRecord(checks) && Array.isArray(checks.check_runs) ? checks.check_runs : [];
    const failedStates = new Set(["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"]);
    const conclusions = runs.map((item) => isRecord(item) ? String(item.conclusion ?? "") : "");
    const failedCount = conclusions.filter((state) => failedStates.has(state)).length;
    const pendingCount = runs.filter((item) => !isRecord(item) || item.status !== "completed" || item.conclusion === null).length;
    const passedCount = conclusions.filter((state) => state === "SUCCESS").length;
    const failed = failedCount > 0;
    const pending = pendingCount > 0;
    const signal = {
      checks: failed ? "failed" : pending ? "pending" : runs.length ? "passing" : "none",
      review,
      ...(reviewerFact.approvers.length
        ? { approvers: reviewerFact.approvers }
        : {}),
      ...(reviewerFact.changeRequesters.length
        ? { changeRequesters: reviewerFact.changeRequesters }
        : {}),
      ...metadata,
    } satisfies GitHubSignal;
    lifecycle.cacheGitHubPullRequestSignal(signalKey(owner, repo, number), signal, Date.now() + GITHUB_SIGNAL_CACHE_MS);
    return {
      pullRequest: recoveredPullRequest,
      signal,
      checks: {
        failedCount,
        passedCount,
        pendingCount,
        state: failed ? "failing" : pending ? "pending" : runs.length ? "passing" : "no_checks",
        totalCount: runs.length,
      },
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
): Promise<{ number: number; base: string; currentPullRequest: number; pullRequests: Array<GitHubPullRequest & GitHubSignal> } | null> {
  const raw = parseGitHubStackResponse(JSON.parse(await run(githubStackApiArgs(owner, repo, pullRequest), 4_000_000)));
  if (!raw) return null;
  const pullRequests = await Promise.all(raw.pullRequests.map(async (item) => {
    if (!needsGitHubPullRequestRecovery(item)) return item;
    const recovered = await readGitHubPullRequestRest(owner, repo, item.number, lifecycle, run);
    if (!recovered) return { ...item, url: item.url || `https://github.com/${owner}/${repo}/pull/${item.number}` };
    lifecycle.cacheGitHubPullRequestSignal(signalKey(owner, repo, item.number), recovered.signal, Date.now() + GITHUB_SIGNAL_CACHE_MS);
    return { ...item, ...recovered.pullRequest };
  }));
  const signals = await readGitHubSignals(owner, repo, pullRequests.map((item) => item.number), lifecycle, run);
  return {
    number: raw.number,
    base: raw.base,
    currentPullRequest: pullRequest,
    pullRequests: pullRequests.map((item) => ({ ...item, ...(signals.get(item.number) ?? { checks: "unknown", review: "none" }) })),
  };
}
