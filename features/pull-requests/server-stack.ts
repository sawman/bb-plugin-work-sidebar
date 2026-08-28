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

export function githubStackApiArgs(owner: string, repo: string, pullRequest: number): string[] {
  return [
    "api", "--method", "GET", `repos/${owner}/${repo}/stacks`,
    "-f", `pull_request=${pullRequest}`,
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
    head: requiredString(head, "pull request head"),
    base: typeof base === "string" ? base : "",
    title: typeof value.title === "string" ? value.title : `Pull request #${value.number}`,
    url: typeof value.html_url === "string" ? value.html_url : "",
    reviewCommentCount: typeof value.review_comments === "number" && Number.isFinite(value.review_comments) ? value.review_comments : 0,
  };
}

export function parseGitHubStackResponse(value: unknown): { number: number; base: string; pullRequests: GitHubPullRequest[] } | null {
  const candidates = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.stacks) ? value.stacks : [value];
  const first = candidates[0];
  if (!first) return null;
  if (!isRecord(first)) throw new Error("GitHub Stack response contains an invalid stack");
  const base = isRecord(first.base) ? first.base.ref : undefined;
  if (!Array.isArray(first.pull_requests)) throw new Error("GitHub Stack response is missing pull_requests");
  return {
    number: requiredNumber(first.number, "stack number"),
    base: requiredString(base, "stack base"),
    pullRequests: first.pull_requests.map(parseStackPullRequest),
  };
}

export async function readGitHubPullRequestDiff(
  owner: string,
  repo: string,
  pullRequest: number,
  run: GitHubApiRunner,
): Promise<NonNullable<GitHubStackBranch["diff"]>> {
  const raw: unknown = JSON.parse(await run([
    "api",
    "--method",
    "GET",
    `repos/${owner}/${repo}/pulls/${pullRequest}/files?per_page=100`,
    "-H",
    `Accept: ${GITHUB_ACCEPT_HEADER}`,
    "-H",
    `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
  ], 4_000_000));
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

function signalFromGraphql(value: unknown): GitHubSignal | null {
  if (!isRecord(value)) return null;
  const reviewDecision = String(value.reviewDecision ?? "");
  const reviewRequests = isRecord(value.reviewRequests) && typeof value.reviewRequests.totalCount === "number"
    ? value.reviewRequests.totalCount : 0;
  const review = reviewDecision === "APPROVED" ? "approved"
    : reviewDecision === "CHANGES_REQUESTED" ? reviewRequests > 0 ? "changes_requested_review_requested" : "changes_requested"
      : reviewRequests > 0 ? "review_requested" : reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
  const commits = isRecord(value.commits) && Array.isArray(value.commits.nodes) ? value.commits.nodes : [];
  const commit = commits[commits.length - 1];
  const rollup = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.statusCheckRollup)
    ? commit.commit.statusCheckRollup : null;
  const state = String(rollup?.state ?? "");
  const checks = state === "SUCCESS" ? "passing"
    : state === "FAILURE" || state === "ERROR" ? "failed"
      : state ? "pending" : "none";
  return { checks, review };
}

function signalKey(owner: string, repo: string, number: number) {
  return `${owner}/${repo}#${number}`.toLowerCase();
}

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
    const selections = missing.map((number, index) =>
      `p${index}: pullRequest(number: ${number}) { reviewDecision reviewRequests(first: 1) { totalCount } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`,
    ).join(" ");
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
    const request = readRestSignal(owner, repo, number, lifecycle, run)
      .finally(() => lifecycle.releasePending("pullRequestSignal", key));
    lifecycle.githubPullRequestSignalPending.set(key, request);
    return [number, await request] as const;
  }));
  for (const [number, signal] of fallback) {
    if (signal) signals.set(number, signal);
  }
  return signals;
}

async function readRestSignal(
  owner: string,
  repo: string,
  number: number,
  lifecycle: ServerLifecycle,
  run: GitHubApiRunner,
): Promise<GitHubSignal | null> {
  try {
    const headers = ["-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`];
    const [pullRequestText, reviewsText] = await Promise.all([
      run(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, ...headers], 2_000_000),
      run(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, ...headers], 2_000_000),
    ]);
    const pullRequest = JSON.parse(pullRequestText) as unknown;
    const reviews = JSON.parse(reviewsText) as unknown;
    if (!isRecord(pullRequest)) return null;
    const requestedReviewers = Array.isArray(pullRequest.requested_reviewers) ? pullRequest.requested_reviewers.length : 0;
    const requestedTeams = Array.isArray(pullRequest.requested_teams) ? pullRequest.requested_teams.length : 0;
    const latestReviewByUser = new Map<string, string>();
    if (Array.isArray(reviews)) for (const review of reviews) {
      if (!isRecord(review) || !isRecord(review.user) || typeof review.user.login !== "string" || typeof review.state !== "string") continue;
      latestReviewByUser.set(review.user.login, review.state);
    }
    const reviewStates = [...latestReviewByUser.values()];
    const requests = requestedReviewers + requestedTeams;
    const review = reviewStates.includes("CHANGES_REQUESTED")
      ? requests > 0 ? "changes_requested_review_requested" : "changes_requested"
      : reviewStates.includes("APPROVED") ? "approved"
        : requests > 0 ? "review_requested" : "none";
    const sha = isRecord(pullRequest.head) && typeof pullRequest.head.sha === "string" ? pullRequest.head.sha : null;
    if (!sha) return { checks: "unknown", review };
    const checks = JSON.parse(await run([
      "api", "--method", "GET", `repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
      ...headers,
    ], 4_000_000)) as unknown;
    const runs = isRecord(checks) && Array.isArray(checks.check_runs) ? checks.check_runs : [];
    const conclusions = runs.map((item) => isRecord(item) ? String(item.conclusion ?? "") : "");
    const failed = conclusions.some((state) => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(state));
    const pending = runs.some((item) => !isRecord(item) || item.status !== "completed" || item.conclusion === null);
    const signal = { checks: failed ? "failed" : pending ? "pending" : runs.length ? "passing" : "none", review } satisfies GitHubSignal;
    lifecycle.cacheGitHubPullRequestSignal(signalKey(owner, repo, number), signal, Date.now() + GITHUB_SIGNAL_CACHE_MS);
    return signal;
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
    if (item.url) return item;
    try {
      const details = JSON.parse(await run([
        "api", "--method", "GET", `repos/${owner}/${repo}/pulls/${item.number}`,
        "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
        "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
      ], 2_000_000)) as unknown;
      if (!isRecord(details)) return item;
      return {
        ...item,
        title: typeof details.title === "string" ? details.title : item.title,
        url: typeof details.html_url === "string" ? details.html_url : `https://github.com/${owner}/${repo}/pull/${item.number}`,
        state: details.merged === true ? "merged" : typeof details.state === "string" ? details.state : item.state,
        draft: typeof details.draft === "boolean" ? details.draft : item.draft,
        head: isRecord(details.head) && typeof details.head.ref === "string" ? details.head.ref : item.head,
        base: isRecord(details.base) && typeof details.base.ref === "string" ? details.base.ref : item.base,
      };
    } catch {
      return { ...item, url: `https://github.com/${owner}/${repo}/pull/${item.number}` };
    }
  }));
  const signals = await readGitHubSignals(owner, repo, pullRequests.map((item) => item.number), lifecycle, run);
  return {
    number: raw.number,
    base: raw.base,
    currentPullRequest: pullRequest,
    pullRequests: pullRequests.map((item) => ({ ...item, ...(signals.get(item.number) ?? { checks: "unknown", review: "none" }) })),
  };
}
