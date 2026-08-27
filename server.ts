import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { normalizePullRequestSignal } from "./features/pull-requests/presentation.js";
import { classifyPullRequestError, createPullRequestService } from "./features/pull-requests/server.js";
import { rpcContract } from "./contracts.js";
import { sanitizeThreadOrder, type SidebarStack } from "./work-model.js";
import { createServerLifecycle, type GitHubApiHealth, type ServerLifecycle } from "./server-lifecycle.js";

const execFileAsync = promisify(execFile);
const TASKS_PLUGIN_ID = "tasks";
const SIDEBAR_ORDER_KEY = "sidebar-thread-order:v1";
const THREAD_LIST_MODE_KEY = "sidebar-thread-list-mode:v1";
const LATER_THREADS_KEY = "sidebar-later-threads:v1";
const THREAD_GROUPS_KEY = "sidebar-thread-groups:v1";
const WORK_BINDINGS_KEY = "work-bindings:v2";
const TASK_ASSIGNEES_KEY = "sidebar-task-assignees:v1";
const LINEAR_LINKS_KEY = "work-linear-links:v1";
const TASKBOARD_PLUGIN_ID = "taskboard";
const GITHUB_STACK_PLUGIN_ID = "gh-stack";
// Plugin hosts do not inherit the interactive shell PATH. BB_CLI is injected
// by BB specifically so plugins can invoke the same daemon-compatible binary.
const BB_CLI = process.env.BB_CLI || "bb";
let activeLifecycle: ServerLifecycle | null = null;
function runtime(): ServerLifecycle {
  if (!activeLifecycle) throw new Error("Work Sidebar server lifecycle is not active");
  return activeLifecycle;
}
export const SIDEBAR_ORDER_CHANNEL = "sidebar-order:changed";
export const GITHUB_STACK_API_VERSION = "2026-03-10";
export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
const PROVIDER_STATUS_URLS: Readonly<Record<string, string>> = {
  codex: "https://status.openai.com/",
  "claude-code": "https://status.claude.com/",
  "acp-cursor": "https://status.cursor.com/",
};
const GITHUB_READ_CACHE_MS = 2 * 60_000;
const GITHUB_SEARCH_CACHE_MS = 5 * 60_000;
const GITHUB_SIGNAL_CACHE_MS = 2 * 60_000;
// GitHub does not reliably include reset headers in gh's GraphQL error text.
// A full window is conservative, but prevents every sidebar refresh from
// immediately re-probing a bucket that GitHub has already exhausted.
const GITHUB_GRAPHQL_BACKOFF_MS = 60 * 60_000;
const taskIdSchema = z.string().regex(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/);
const taskThreadIdSchema = z.string().startsWith("thr_");

const taskSchema = z.object({
  id: taskIdSchema, projectId: taskIdSchema, number: z.number().int().positive(), key: z.string(), title: z.string(),
  description: z.string(),
  status: z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]),
  priority: z.enum(["urgent", "high", "medium", "low", "none"]),
  dueDate: z.string().nullable(), parentTaskId: taskIdSchema.nullable(), position: z.number(),
  createdAt: z.string(), updatedAt: z.string(), labelIds: z.array(taskIdSchema),
});
const taskThreadSchema = z.object({
  id: taskIdSchema, taskId: taskIdSchema, threadId: taskThreadIdSchema, presetName: z.string(), title: z.string(),
  liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]), attachedAt: z.string(), updatedAt: z.string(),
});
const projectSchema = z.object({
  id: taskIdSchema, name: z.string(), prefix: z.string(), nextTaskNumber: z.number().int().positive(), color: z.string(),
  folderId: taskIdSchema.nullable(), linkedBbProjectId: z.string().startsWith("proj_").nullable(), createdAt: z.string(),
});
type Task = z.infer<typeof taskSchema>;
const taskPageSchema = z.object({ tasks: z.array(taskSchema), nextCursor: z.string().nullable() });
type TaskSummary = ReturnType<typeof summarizeTask>;
type DispatchState = "ready" | "pending_spawn" | "pending_attachment" | "recovery_required";
type BindingMode = "direct" | "delegated";

const trackerItemSchema = z.object({
  bbProjectId: z.string(), source: z.literal("linear"), locator: z.string(), key: z.string(), title: z.string(),
  description: z.string(), url: z.string().url(), status: z.string(),
  stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]),
  priority: z.string().nullable(), assignee: z.string().nullable(), project: z.string().nullable(),
  labels: z.array(z.string()), updatedAt: z.string(),
});
const trackerDetailSchema = trackerItemSchema.extend({ comments: z.array(z.object({ author: z.string(), body: z.string(), createdAt: z.string() })) });
const trackerStatusOptionSchema = z.object({ id: z.string(), name: z.string(), stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]), current: z.boolean() });
// Mirrors gh-stack's public getStack payload. Keeping this boundary explicit
// lets the Work panel reuse its authoritative per-layer diffs without taking a
// build-time dependency on an optional plugin.
const stackChangeSchema = z.object({ additions: z.number(), deletions: z.number(), files: z.array(z.object({ path: z.string(), previousPath: z.string().nullable(), status: z.enum(["added", "deleted", "modified", "renamed", "untracked"]), additions: z.number().nullable(), deletions: z.number().nullable() })), truncated: z.boolean() });
const ghStackPayloadSchema = z.object({
  stack: z.object({ trunk: z.string(), currentBranch: z.string().nullable(), branches: z.array(z.object({
    name: z.string(), isCurrent: z.boolean(), isMerged: z.boolean(), isQueued: z.boolean(), needsRebase: z.boolean(), hasStash: z.boolean(), stashCount: z.number().int().nonnegative().nullable(),
    pr: z.object({ number: z.number(), url: z.string().url(), state: z.string(), title: z.string().nullable(), isDraft: z.boolean(), metadataStale: z.boolean() }).nullable(),
    diff: stackChangeSchema.nullable(), aheadOfRemote: z.number().nullable(), behindRemote: z.number().nullable(),
  })), trunkBehind: z.number().nullable(), prunableBranchCount: z.number().int().nonnegative().nullable(),
  }).nullable(), pending: stackChangeSchema.nullable(), error: z.object({ kind: z.string(), message: z.string() }).nullable(), fetchedAt: z.number(),
});
const ghStackActionSchema = z.object({ ok: z.boolean(), message: z.string(), tone: z.enum(["success", "warning", "error"]).optional(), detail: z.string().nullable() });
type LinearLink = { projectId: string; locator: string; key: string };
type LinearLinks = Record<string, LinearLink>;

export interface OutcomeBinding {
  kind: "outcome";
  rootThreadId: string;
  outcomeTaskId: string;
  taskProjectId: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutionBinding {
  kind: "execution";
  rootThreadId: string;
  outcomeTaskId: string;
  taskProjectId: string;
  executionTaskId: string;
  ownerThreadId: string | null;
  mode: BindingMode | null;
  idempotencyKey: string;
  dispatchState: DispatchState;
  recoveryMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface WorkBindings { outcomes: OutcomeBinding[]; executions: ExecutionBinding[]; }

function emptyBindings(): WorkBindings { return { outcomes: [], executions: [] }; }

function isDispatchState(value: unknown): value is DispatchState {
  return value === "ready" || value === "pending_spawn" || value === "pending_attachment" || value === "recovery_required";
}

/** Sanitizes only our own persisted model; Tasks attachments are never inferred as ownership. */
export function normalizeBindings(value: unknown): WorkBindings {
  if (!isRecord(value) || !Array.isArray(value.outcomes) || !Array.isArray(value.executions)) return emptyBindings();
  const outcomes = value.outcomes.flatMap((row): OutcomeBinding[] => isRecord(row)
    && row.kind === "outcome" && typeof row.rootThreadId === "string" && typeof row.outcomeTaskId === "string"
    && typeof row.taskProjectId === "string" && typeof row.createdAt === "string" && typeof row.updatedAt === "string"
    ? [{ kind: "outcome", rootThreadId: row.rootThreadId, outcomeTaskId: row.outcomeTaskId, taskProjectId: row.taskProjectId, createdAt: row.createdAt, updatedAt: row.updatedAt }]
    : []);
  const executions = value.executions.flatMap((row): ExecutionBinding[] => isRecord(row)
    && row.kind === "execution" && typeof row.rootThreadId === "string" && typeof row.outcomeTaskId === "string"
    && typeof row.taskProjectId === "string" && typeof row.executionTaskId === "string" && typeof row.idempotencyKey === "string"
    && (row.ownerThreadId === null || typeof row.ownerThreadId === "string")
    && (row.mode === null || row.mode === "direct" || row.mode === "delegated")
    && isDispatchState(row.dispatchState) && (row.recoveryMessage === null || typeof row.recoveryMessage === "string")
    && typeof row.createdAt === "string" && typeof row.updatedAt === "string"
    ? [{ kind: "execution", rootThreadId: row.rootThreadId, outcomeTaskId: row.outcomeTaskId, taskProjectId: row.taskProjectId, executionTaskId: row.executionTaskId, ownerThreadId: row.ownerThreadId, mode: row.mode, idempotencyKey: row.idempotencyKey, dispatchState: row.dispatchState, recoveryMessage: row.recoveryMessage, createdAt: row.createdAt, updatedAt: row.updatedAt }]
    : []);
  return { outcomes, executions };
}

/** Reuses only a stable execution key in plugin-owned state, never an attachment. */
export function upsertExecutionBinding(bindings: WorkBindings, binding: ExecutionBinding): { bindings: WorkBindings; reused: boolean } {
  const index = bindings.executions.findIndex((item) => item.rootThreadId === binding.rootThreadId && item.idempotencyKey === binding.idempotencyKey);
  if (index >= 0) return { bindings, reused: true };
  return { bindings: { outcomes: [...bindings.outcomes], executions: [...bindings.executions, binding] }, reused: false };
}

export function bindExecutionOwner(binding: ExecutionBinding, mode: BindingMode, ownerThreadId: string | null, dispatchState: DispatchState, recoveryMessage: string | null): ExecutionBinding {
  return { ...binding, mode, ownerThreadId, dispatchState, recoveryMessage, updatedAt: new Date().toISOString() };
}

export function executionBindingDispatchProblem(binding: ExecutionBinding): string | null {
  if (binding.dispatchState === "recovery_required") return binding.recoveryMessage ?? "the prior dispatch outcome is uncertain";
  if (binding.dispatchState === "pending_spawn") return "the prior delegated spawn is still pending or was interrupted before a child thread id was durably confirmed";
  if (binding.dispatchState === "pending_attachment") return `the prior thread dispatch is pending task attachment${binding.ownerThreadId ? ` for ${binding.ownerThreadId}` : ""}`;
  if (binding.mode && !binding.ownerThreadId) return `the ${binding.mode} execution binding has no durable owner thread`;
  return null;
}

export interface CurrentPullRequest {
  number: number;
  title: string;
  url: string;
  state: "closed" | "draft" | "merged" | "open";
  head: string;
  base: string;
  checks: {
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    state: "failing" | "no_checks" | "passing" | "pending" | "unknown";
    totalCount: number;
  };
  review: {
    reviewRequestCount: number;
    state: "approved" | "changes_requested" | "none" | "review_requested" | "review_required";
  };
  attention: "blocked" | "changes_requested" | "checks_failed" | "checks_pending" | "closed" | "conflicts" | "draft" | "merged" | "none" | "ready_to_merge" | "review_requested";
  mergeability: {
    mergeStateStatus: "BEHIND" | "BLOCKED" | "CLEAN" | "DRAFT" | "HAS_HOOKS" | "DIRTY" | "UNKNOWN" | "UNSTABLE" | null;
    mergeable: "CONFLICTING" | "MERGEABLE" | "UNKNOWN" | null;
    state: "blocked" | "conflicts" | "draft" | "mergeable" | "unknown";
  };
  signal: { checks: "failed" | "passing" | "pending" | "none" | "unknown"; review: "approved" | "changes_requested" | "changes_requested_review_requested" | "review_requested" | "review_required" | "none"; reviewCommentCount: number; };
}

interface StackPullRequest {
  number: number;
  state: string;
  draft: boolean;
  head: string;
  base: string;
  title?: string;
  url?: string;
  reviewCommentCount?: number;
}

interface GitHubStackResponse {
  number: number;
  base: string;
  pull_requests: StackPullRequest[];
}

interface GitHubSearchPullRequest {
  number: number;
  title: string;
  url: string;
  repository: { nameWithOwner?: string };
  state: "open";
  isDraft?: boolean;
}

interface GitHubPullRequestDetails {
  number?: number;
  title?: string;
  html_url?: string;
  state?: string;
  merged?: boolean;
  draft?: boolean;
  head?: { ref?: string };
  base?: { ref?: string };
}

export type GitHubApiRunner = (args: readonly string[], maxBuffer: number) => Promise<string>;

function githubReadScope(args: readonly string[]) { return args[0] === "api" && args[1] === "graphql" ? "graphql" as const : "rest" as const; }
function githubReadHealth(): GitHubApiHealth {
  if (runtime().githubGraphqlHealth.state !== "available") return runtime().githubGraphqlHealth;
  if (runtime().githubRestHealth.state !== "available") return runtime().githubRestHealth;
  return { state: "available", scope: "unknown", message: null, retryAt: null };
}
function clearGitHubReadCache() {
  runtime().githubReadCache.clear();
  runtime().githubPullRequestSignalCache.clear();
}
function githubReadError(owner: ServerLifecycle, scope: "graphql" | "rest", error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error);
  const health: GitHubApiHealth = classifyPullRequestError(error, scope);
  if (owner.isDisposed) return new Error(message);
  if (scope === "graphql") {
    owner.githubGraphqlHealth = health;
    if (health.state === "rate_limited") owner.githubGraphqlBackoffUntil = health.retryAt ?? Date.now() + GITHUB_GRAPHQL_BACKOFF_MS;
  } else owner.githubRestHealth = health;
  return new Error(message);
}
async function runCachedGitHubRead(args: readonly string[], maxBuffer: number, ttlMs = GITHUB_READ_CACHE_MS, owner = runtime()): Promise<string> {
  const scope = githubReadScope(args);
  const health = scope === "graphql" ? owner.githubGraphqlHealth : owner.githubRestHealth;
  if (health.state === "rate_limited" && health.retryAt && health.retryAt > Date.now()) throw new Error(health.message ?? "GitHub API is rate limited.");
  const key = args.join("\u0000");
  const cached = owner.githubReadCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = owner.githubReadPending.get(key);
  if (pending) return pending;
  const request = execFileAsync("gh", [...args], { maxBuffer }).then(({ stdout }) => {
    if (owner.isDisposed) return stdout;
    if (scope === "graphql") owner.githubGraphqlHealth = { state: "available", scope, message: null, retryAt: null };
    else owner.githubRestHealth = { state: "available", scope, message: null, retryAt: null };
    if (owner.githubReadCache.size >= 300) owner.githubReadCache.delete(owner.githubReadCache.keys().next().value!);
    owner.cacheGitHubRead(key, stdout, Date.now() + ttlMs);
    return stdout;
  }).catch((error) => { throw githubReadError(owner, scope, error); }).finally(() => { owner.releasePending("githubRead", key); });
  owner.githubReadPending.set(key, request);
  return request;
}
const runGitHubApi: GitHubApiRunner = runCachedGitHubRead;

export function githubStackApiArgs(owner: string, repo: string, pullRequest: number): string[] {
  return [
    "api", "--method", "GET", `repos/${owner}/${repo}/stacks`,
    "-f", `pull_request=${pullRequest}`,
    "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
    "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
  ];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

type SidebarThreadGroup = { id: string; name: string; threadIds: string[] };

export function normalizeThreadGroups(value: unknown, legacyLater: unknown = []): SidebarThreadGroup[] {
  const rawGroups = isRecord(value) && Array.isArray(value.groups) ? value.groups : null;
  const candidates = rawGroups ?? [{ id: "group_later", name: "Later", threadIds: sanitizeThreadOrder(legacyLater) }];
  const usedIds = new Set<string>();
  const assignedThreads = new Set<string>();
  return candidates.flatMap((candidate): SidebarThreadGroup[] => {
    if (!isRecord(candidate) || typeof candidate.id !== "string" || !/^group_[a-z0-9_-]{1,48}$/.test(candidate.id) || usedIds.has(candidate.id)) return [];
    const name = typeof candidate.name === "string" ? candidate.name.trim().slice(0, 40) : "";
    if (!name) return [];
    usedIds.add(candidate.id);
    const threadIds = sanitizeThreadOrder(candidate.threadIds).filter((threadId) => !assignedThreads.has(threadId));
    threadIds.forEach((threadId) => assignedThreads.add(threadId));
    return [{ id: candidate.id, name, threadIds }];
  });
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`GitHub Stack response has invalid ${field}`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`GitHub Stack response has invalid ${field}`);
  return value;
}

type ParsedGitHubPullRequestDetails = {
  title?: string;
  htmlUrl?: string;
  state?: string;
  merged?: boolean;
  draft?: boolean;
  reviewCommentCount?: number;
  head?: string;
  base?: string;
};

function parseGitHubPullRequestDetails(value: unknown): ParsedGitHubPullRequestDetails {
  if (!isRecord(value)) return {};
  return {
    title: typeof value.title === "string" ? value.title : undefined,
    htmlUrl: typeof value.html_url === "string" ? value.html_url : undefined,
    state: typeof value.state === "string" ? value.state : undefined,
    merged: typeof value.merged === "boolean" ? value.merged : undefined,
    draft: typeof value.draft === "boolean" ? value.draft : undefined,
    reviewCommentCount: typeof value.review_comments === "number" && Number.isFinite(value.review_comments) ? value.review_comments : undefined,
    head: isRecord(value.head) && typeof value.head.ref === "string" ? value.head.ref : undefined,
    base: isRecord(value.base) && typeof value.base.ref === "string" ? value.base.ref : undefined,
  };
}

function parseStackPullRequest(value: unknown): StackPullRequest {
  if (!isRecord(value)) throw new Error("GitHub Stack response has an invalid pull request");
  const head = isRecord(value.head) ? value.head.ref : undefined;
  const base = isRecord(value.base) && typeof value.base.ref === "string" ? value.base.ref : "";
  return {
    number: requiredNumber(value.number, "pull request number"),
    state: requiredString(value.state, "pull request state"),
    draft: typeof value.draft === "boolean" ? value.draft : false,
    head: requiredString(head, "pull request head"),
    base,
    title: typeof value.title === "string" ? value.title : undefined,
    url: typeof value.html_url === "string" ? value.html_url : undefined,
    reviewCommentCount: typeof value.review_comments === "number" && Number.isFinite(value.review_comments) ? value.review_comments : undefined,
  };
}

export function parseGitHubStackResponse(value: unknown): GitHubStackResponse | null {
  const candidates = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.stacks)
      ? value.stacks
      : [value];
  const first = candidates[0];
  if (!first) return null;
  if (!isRecord(first)) throw new Error("GitHub Stack response contains an invalid stack");
  const base = isRecord(first.base) ? first.base.ref : undefined;
  if (!Array.isArray(first.pull_requests)) throw new Error("GitHub Stack response is missing pull_requests");
  return {
    number: requiredNumber(first.number, "stack number"),
    base: requiredString(base, "stack base"),
    pull_requests: first.pull_requests.map(parseStackPullRequest),
  };
}

export async function fetchGitHubStack(
  owner: string,
  repo: string,
  pullRequest: number,
  run: GitHubApiRunner = runGitHubApi,
) : Promise<{ number: number; base: string; currentPullRequest: number; pullRequests: Array<{
  number: number; title: string; state: string; draft: boolean; url: string; head: string; base: string; reviewCommentCount: number;
  checks: "failed" | "passing" | "pending" | "none" | "unknown"; review: "approved" | "changes_requested" | "changes_requested_review_requested" | "review_requested" | "review_required" | "none";
}> } | null> {
  const raw = parseGitHubStackResponse(JSON.parse(await run(githubStackApiArgs(owner, repo, pullRequest), 4_000_000)));
  if (!raw) return null;
  const pullRequests = await Promise.all(raw.pull_requests.map(async (pr) => {
    // The Stack endpoint normally returns embedded PR objects. Use that
    // payload first: a stack no longer costs one REST request per layer.
    if (pr.title && pr.url) return {
      number: pr.number, title: pr.title, state: pr.state, draft: pr.draft,
      url: pr.url, head: pr.head, base: pr.base, reviewCommentCount: pr.reviewCommentCount ?? 0,
    };
    try {
      const details = parseGitHubPullRequestDetails(JSON.parse(await run([
        "api", "--method", "GET", `repos/${owner}/${repo}/pulls/${pr.number}`,
        "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
        "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
      ], 2_000_000)));
      return {
        number: pr.number,
        title: details.title ?? `Pull request #${pr.number}`,
        // GitHub's REST endpoint reports merged PRs as state=closed with a
        // separate boolean. Normalize that pair before it reaches the UI.
        state: details.merged ? "merged" : details.state ?? pr.state,
        draft: details.draft ?? pr.draft,
        url: details.htmlUrl ?? `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        head: details.head ?? pr.head,
        base: details.base ?? pr.base,
        reviewCommentCount: details.reviewCommentCount ?? 0,
      };
    } catch {
      return {
        number: pr.number,
        title: `Pull request #${pr.number}`,
        state: pr.state,
        draft: pr.draft,
        url: `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        head: pr.head,
        base: pr.base,
        reviewCommentCount: 0,
      };
    }
  }));
  const signals = await repositoryPullRequestSignals(owner, repo, pullRequests.map((item) => item.number));
  return { number: raw.number, base: raw.base, currentPullRequest: pullRequest, pullRequests: pullRequests.map((item) => ({
    ...item,
    ...(signals.get(item.number) ?? UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL),
  })) };
}

function parseAuthoredPullRequestSearch(value: unknown): GitHubSearchPullRequest[] {
  if (!Array.isArray(value)) throw new Error("GitHub returned an invalid authored pull request list");
  return value.flatMap((entry): GitHubSearchPullRequest[] => {
    if (!isRecord(entry) || typeof entry.number !== "number" || typeof entry.title !== "string" || typeof entry.url !== "string" || !isRecord(entry.repository) || typeof entry.repository.nameWithOwner !== "string" || String(entry.state).toUpperCase() !== "OPEN") return [];
    return [{ number: entry.number, title: entry.title, url: entry.url, repository: { nameWithOwner: entry.repository.nameWithOwner }, state: "open", isDraft: entry.isDraft === true }];
  });
}

/** Resolve repository archival in batches rather than one REST call per PR. */
async function archivedGitHubRepositories(repositories: readonly string[]): Promise<Set<string>> {
  const unique = [...new Set(repositories)].filter((repository) => /^[^/]+\/[^/]+$/.test(repository));
  const archived = new Set<string>();
  // GitHub's search JSON includes a repository name but not its archived flag.
  // Use GraphQL aliases in modest batches to keep this account-wide list fast.
  for (let start = 0; start < unique.length; start += 50) {
    const batch = unique.slice(start, start + 50);
    const selections = batch.map((repository, index) => {
      const slash = repository.indexOf("/");
      const owner = repository.slice(0, slash);
      const name = repository.slice(slash + 1);
      return `r${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { isArchived }`;
    }).join(" ");
    try {
      const stdout = await runCachedGitHubRead(["api", "graphql", "-f", `query=query { ${selections} }`], 2_000_000);
      const parsed: unknown = JSON.parse(stdout);
      const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : {};
      batch.forEach((repository, index) => {
        const result = data[`r${index}`];
        if (isRecord(result) && result.isArchived === true) archived.add(repository);
      });
    } catch {
      // Search visibility remains useful during a transient metadata failure;
      // the short PR cache retries archival filtering on its next refresh.
    }
  }
  return archived;
}

type AuthoredPullRequestSignal = {
  checks: "failed" | "passing" | "pending" | "none" | "unknown";
  review: "approved" | "changes_requested" | "changes_requested_review_requested" | "review_requested" | "review_required" | "none";
};
// A failed metadata lookup is not evidence that a PR has no CI. Keeping it
// distinct prevents private or temporarily unavailable repositories reading as
// an empty check set in the UI.
const UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL: AuthoredPullRequestSignal = { checks: "unknown", review: "none" };

function pullRequestSignalKey(owner: string, repo: string, number: number) { return `${owner}/${repo}#${number}`.toLowerCase(); }
function cachedPullRequestSignal(owner: string, repo: string, number: number): AuthoredPullRequestSignal | null {
  const cached = runtime().githubPullRequestSignalCache.get(pullRequestSignalKey(owner, repo, number)) as { expiresAt: number; value: AuthoredPullRequestSignal } | undefined;
  return cached && cached.expiresAt > Date.now() ? cached.value : null;
}
function cachePullRequestSignal(owner: string, repo: string, number: number, value: AuthoredPullRequestSignal) {
  if (value.checks === "unknown" && value.review === "none") return;
  runtime().githubPullRequestSignalCache.set(pullRequestSignalKey(owner, repo, number), { value, expiresAt: Date.now() + GITHUB_SIGNAL_CACHE_MS });
}
function isGitHubGraphqlRateLimit(error: unknown) { return /graphql_rate_limit|API rate limit already exceeded|secondary rate limit/i.test(error instanceof Error ? error.message : String(error)); }

/**
 * GraphQL is the cheapest way to enrich a stack, but it can be unavailable
 * independently of the REST API (for example, on a transient GraphQL rate
 * limit). REST keeps the status badges truthful instead of showing the
 * misleading "no reviewer / pending" fallback in that case.
 */
async function restPullRequestSignal(owner: string, repo: string, number: number, lifecycle: ServerLifecycle): Promise<AuthoredPullRequestSignal | null> {
  try {
    const pullRequestPromise = runCachedGitHubRead(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], 2_000_000, GITHUB_READ_CACHE_MS, lifecycle);
    const reviewsPromise = runCachedGitHubRead(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}/reviews?per_page=100`, "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], 2_000_000, GITHUB_READ_CACHE_MS, lifecycle);
    const [pullRequestStdout, reviewsStdout] = await Promise.all([pullRequestPromise, reviewsPromise]);
    const pullRequest = JSON.parse(pullRequestStdout) as unknown;
    const reviews = JSON.parse(reviewsStdout) as unknown;
    if (!isRecord(pullRequest)) return null;
    const requestedReviewers = Array.isArray(pullRequest.requested_reviewers) ? pullRequest.requested_reviewers.length : 0;
    const requestedTeams = Array.isArray(pullRequest.requested_teams) ? pullRequest.requested_teams.length : 0;
    const reviewRequests = requestedReviewers + requestedTeams;
    const latestReviewByUser = new Map<string, string>();
    if (Array.isArray(reviews)) for (const review of reviews) {
      if (!isRecord(review) || !isRecord(review.user) || typeof review.user.login !== "string" || typeof review.state !== "string") continue;
      latestReviewByUser.set(review.user.login, review.state);
    }
    const reviewStates = [...latestReviewByUser.values()];
    const review: AuthoredPullRequestSignal["review"] = reviewStates.includes("CHANGES_REQUESTED")
      ? reviewRequests > 0 ? "changes_requested_review_requested" : "changes_requested"
      : reviewStates.includes("APPROVED") ? "approved"
      : reviewRequests > 0 ? "review_requested" : "none";
    const sha = isRecord(pullRequest.head) && typeof pullRequest.head.sha === "string" ? pullRequest.head.sha : null;
    if (!sha) return { checks: "unknown", review };
    const checksStdout = await runCachedGitHubRead(["api", "--method", "GET", `repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`, "-H", "Accept: application/vnd.github+json", "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], 4_000_000, GITHUB_READ_CACHE_MS, lifecycle);
    const checksResponse = JSON.parse(checksStdout) as unknown;
    const checkRuns = isRecord(checksResponse) && Array.isArray(checksResponse.check_runs) ? checksResponse.check_runs : [];
    const conclusions = checkRuns.map((check) => isRecord(check) ? String(check.conclusion ?? "") : "");
    const failed = conclusions.some((conclusion) => ["FAILURE", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE", "STALE"].includes(conclusion));
    const pending = checkRuns.some((check) => !isRecord(check) || check.status !== "completed" || check.conclusion === null);
    return { checks: failed ? "failed" : pending ? "pending" : checkRuns.length ? "passing" : "none", review };
  } catch {
    return null;
  }
}

function cachedRestPullRequestSignal(owner: string, repo: string, number: number): Promise<AuthoredPullRequestSignal | null> {
  const lifecycle = runtime();
  const cached = cachedPullRequestSignal(owner, repo, number);
  if (cached) return Promise.resolve(cached);
  const key = pullRequestSignalKey(owner, repo, number);
  const pending = lifecycle.githubPullRequestSignalPending.get(key) as Promise<AuthoredPullRequestSignal | null> | undefined;
  if (pending) return pending;
  const request = restPullRequestSignal(owner, repo, number, lifecycle).then((signal) => {
    if (!lifecycle.isDisposed && signal && !(signal.checks === "unknown" && signal.review === "none")) {
      lifecycle.githubPullRequestSignalCache.set(key, { value: signal, expiresAt: Date.now() + GITHUB_SIGNAL_CACHE_MS });
    }
    return signal;
  }).finally(() => { lifecycle.releasePending("pullRequestSignal", key); });
  lifecycle.githubPullRequestSignalPending.set(key, request);
  return request;
}

/** Fetch the compact status badges for every PR in one repository stack. */
async function repositoryPullRequestSignals(owner: string, repo: string, numbers: readonly number[]): Promise<Map<number, AuthoredPullRequestSignal>> {
  const unique = [...new Set(numbers)].filter((number) => Number.isInteger(number) && number > 0);
  const signals = new Map<number, AuthoredPullRequestSignal>();
  if (!unique.length) return signals;
  for (const number of unique) {
    const cached = cachedPullRequestSignal(owner, repo, number);
    if (cached) signals.set(number, cached);
  }
  const uncached = unique.filter((number) => !signals.has(number));
  if (uncached.length && Date.now() >= runtime().githubGraphqlBackoffUntil) try {
    const selections = uncached.map((number, index) => `p${index}: pullRequest(number: ${number}) { reviewDecision reviewRequests(first: 1) { totalCount } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } }`).join(" ");
    const stdout = await runCachedGitHubRead(["api", "graphql", "-f", `query=query { repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(repo)}) { ${selections} } }`], 4_000_000);
    const parsed: unknown = JSON.parse(stdout);
    const data = isRecord(parsed) && isRecord(parsed.data) && isRecord(parsed.data.repository) ? parsed.data.repository : {};
    uncached.forEach((number, index) => {
      const pullRequest = data[`p${index}`];
      if (!isRecord(pullRequest)) return;
      const reviewDecision = String(pullRequest.reviewDecision ?? "");
      const reviewRequests = isRecord(pullRequest.reviewRequests) && typeof pullRequest.reviewRequests.totalCount === "number" ? pullRequest.reviewRequests.totalCount : 0;
      const review: AuthoredPullRequestSignal["review"] = reviewDecision === "APPROVED" ? "approved" : reviewDecision === "CHANGES_REQUESTED" ? reviewRequests > 0 ? "changes_requested_review_requested" : "changes_requested" : reviewRequests > 0 ? "review_requested" : reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
      const commits = isRecord(pullRequest.commits) && Array.isArray(pullRequest.commits.nodes) ? pullRequest.commits.nodes : [];
      const commit = commits[commits.length - 1];
      const rollup = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.statusCheckRollup) ? commit.commit.statusCheckRollup : null;
      const state = String(rollup?.state ?? "");
      const checks: AuthoredPullRequestSignal["checks"] = state === "SUCCESS" ? "passing" : state === "FAILURE" || state === "ERROR" ? "failed" : state ? "pending" : "none";
      const signal = { checks, review };
      signals.set(number, signal);
      cachePullRequestSignal(owner, repo, number, signal);
    });
  } catch (error) {
    if (isGitHubGraphqlRateLimit(error)) runtime().githubGraphqlBackoffUntil = Date.now() + GITHUB_GRAPHQL_BACKOFF_MS;
    // REST fallback below keeps the stack useful when GraphQL is unavailable.
  }
  const missing = uncached.filter((number) => !signals.has(number));
  if (missing.length) {
    const fallback = await Promise.all(missing.map(async (number) => [number, await cachedRestPullRequestSignal(owner, repo, number)] as const));
    for (const [number, signal] of fallback) if (signal) signals.set(number, signal);
  }
  return signals;
}

/** Fetch the concise CI and review summaries shown beside account-wide PRs. */
async function authoredPullRequestSignals(items: readonly GitHubSearchPullRequest[]): Promise<Map<string, AuthoredPullRequestSignal>> {
  const signals = new Map<string, AuthoredPullRequestSignal>();
  const uncached = items.filter((item) => {
    const repository = item.repository.nameWithOwner;
    if (!repository) return false;
    const [owner, repo] = repository.split("/", 2);
    if (!owner || !repo) return true;
    const cached = cachedPullRequestSignal(owner, repo, item.number);
    if (cached) signals.set(`${repository}#${item.number}`, cached);
    return !cached;
  });
  for (let start = 0; start < uncached.length; start += 50) {
    if (Date.now() < runtime().githubGraphqlBackoffUntil) break;
    const batch = uncached.slice(start, start + 50);
    const selections = batch.flatMap((item, index) => {
      const repository = item.repository.nameWithOwner;
      if (!repository) return [];
      const slash = repository.indexOf("/");
      const owner = repository.slice(0, slash);
      const name = repository.slice(slash + 1);
      return [`p${index}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${item.number}) { reviewDecision reviewRequests(first: 1) { totalCount } commits(last: 1) { nodes { commit { statusCheckRollup { state } } } } } }`];
    }).join(" ");
    if (!selections) continue;
    try {
      const stdout = await runCachedGitHubRead(["api", "graphql", "-f", `query=query { ${selections} }`], 4_000_000);
      const parsed: unknown = JSON.parse(stdout);
      const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : {};
      batch.forEach((item, index) => {
        const repository = item.repository.nameWithOwner;
        const repositoryResult = data[`p${index}`];
        const pullRequest = isRecord(repositoryResult) && isRecord(repositoryResult.pullRequest) ? repositoryResult.pullRequest : null;
        if (!repository || !pullRequest) return;
        const reviewDecision = String(pullRequest.reviewDecision ?? "");
        const reviewRequests = isRecord(pullRequest.reviewRequests) && typeof pullRequest.reviewRequests.totalCount === "number" ? pullRequest.reviewRequests.totalCount : 0;
        const review: AuthoredPullRequestSignal["review"] = reviewDecision === "APPROVED" ? "approved"
          : reviewDecision === "CHANGES_REQUESTED" ? reviewRequests > 0 ? "changes_requested_review_requested" : "changes_requested"
          : reviewRequests > 0 ? "review_requested"
          : reviewDecision === "REVIEW_REQUIRED" ? "review_required" : "none";
        const commits = isRecord(pullRequest.commits) && Array.isArray(pullRequest.commits.nodes) ? pullRequest.commits.nodes : [];
        const commit = commits[commits.length - 1];
        const rollup = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.statusCheckRollup) ? commit.commit.statusCheckRollup : null;
        const state = String(rollup?.state ?? "");
        const checks: AuthoredPullRequestSignal["checks"] = state === "SUCCESS" ? "passing"
          : state === "FAILURE" || state === "ERROR" ? "failed"
          : state ? "pending" : "none";
        const signal = { checks, review };
        signals.set(`${repository}#${item.number}`, signal);
        const [owner, repo] = repository.split("/", 2);
        if (owner && repo) cachePullRequestSignal(owner, repo, item.number, signal);
      });
    } catch (error) {
      if (isGitHubGraphqlRateLimit(error)) { runtime().githubGraphqlBackoffUntil = Date.now() + GITHUB_GRAPHQL_BACKOFF_MS; break; }
      // The main PR search remains useful if one metadata batch fails.
    }
  }
  return signals;
}

export function projectCurrentPullRequest(pullRequest: CurrentPullRequest): CurrentPullRequest {
  return {
    number: pullRequest.number,
    title: pullRequest.title,
    url: pullRequest.url,
    state: pullRequest.state,
    head: pullRequest.head,
    base: pullRequest.base,
    checks: { ...pullRequest.checks },
    review: { ...pullRequest.review },
    attention: pullRequest.attention,
    mergeability: { ...pullRequest.mergeability },
    signal: { ...pullRequest.signal },
  };
}

export function projectSidebarTask(task: Task, projectName: string, linkedThreadIds: readonly string[], assignee: "agent" | "human" = "human") {
  return {
    id: task.id, projectId: task.projectId, projectName, key: task.key, title: task.title,
    status: task.status, priority: task.priority, dueDate: task.dueDate, parentTaskId: task.parentTaskId,
    position: task.position,
    linkedThreadIds: [...linkedThreadIds],
    assignee,
  };
}

function summarizeTask(task: Task, projectName = "Work") {
  return {
    id: task.id, projectId: task.projectId, projectName, key: task.key, title: task.title, status: task.status,
    priority: task.priority, dueDate: task.dueDate, parentTaskId: task.parentTaskId,
  };
}

function projectPrefix(name: string, projectId: string, usedPrefixes: ReadonlySet<string>): string {
  const letters = name.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const base = /^[A-Z]/.test(letters) ? letters.slice(0, 10) : "WORK";
  if (!usedPrefixes.has(base)) return base;
  const suffix = projectId.replace(/[^a-zA-Z0-9]/g, "").slice(-3).toUpperCase();
  return `${base.slice(0, 7) || "WORK"}${suffix}`.slice(0, 10);
}

export function assertThreadEnvironmentProject(threadProjectId: string, environmentProjectId: string, allowedProjectIds: readonly string[] = []) {
  const valid = new Set([threadProjectId, ...allowedProjectIds]);
  if (!valid.has(environmentProjectId)) throw new Error(`Environment project mismatch: environment ${environmentProjectId} does not match thread ${threadProjectId}`);
}

/** Strict precedence for a Tasks project; null means exactly one linked project must be created. */
export function resolveProjectSelection(
  projects: readonly { id: string; linkedBbProjectId: string | null }[],
  threadProjectId: string,
  options: { explicitTaskProjectId?: string | null; parentTaskProjectId?: string | null; bindingTaskProjectId?: string | null },
  validLinkedBbProjectIds: readonly string[] = [],
): string | null {
  const valid = new Set([threadProjectId, ...validLinkedBbProjectIds]);
  const validate = (taskProjectId: string, source: string) => {
    const project = projects.find((candidate) => candidate.id === taskProjectId);
    if (!project) throw new Error(`${source} Tasks project was not found: ${taskProjectId}`);
    if (!project.linkedBbProjectId) throw new Error(`${source} Tasks project must be linked to a BB project`);
    if (!valid.has(project.linkedBbProjectId)) throw new Error(`${source} Tasks project must be linked to thread project ${threadProjectId}`);
    return project.id;
  };
  if (options.explicitTaskProjectId) return validate(options.explicitTaskProjectId, "Explicit");
  if (options.parentTaskProjectId) return validate(options.parentTaskProjectId, "Outcome");
  if (options.bindingTaskProjectId) return validate(options.bindingTaskProjectId, "Binding");
  const linked = projects.filter((project) => project.linkedBbProjectId === threadProjectId);
  if (linked.length > 1) throw new Error(`Ambiguous Tasks project mapping for BB project ${threadProjectId}; found ${linked.length} linked projects`);
  return linked[0]?.id ?? null;
}

function assertOutcomeTaskBinding(binding: OutcomeBinding, task: Task) {
  if (task.parentTaskId !== null) throw new Error("Outcome binding is not a top-level Tasks task; nesting execution work is not supported");
  if (task.projectId !== binding.taskProjectId) throw new Error(`Outcome binding project mismatch: task ${task.id} is in ${task.projectId}, binding expects ${binding.taskProjectId}`);
}

function assertExecutionTaskBinding(binding: ExecutionBinding, task: Task) {
  if (task.parentTaskId !== binding.outcomeTaskId) throw new Error("Execution binding is no longer a direct child of the durable outcome");
  if (task.projectId !== binding.taskProjectId) throw new Error(`Execution binding project mismatch: task ${task.id} is in ${task.projectId}, binding expects ${binding.taskProjectId}`);
}

async function loadSidebarArchivedThreads() {
  const { stdout } = await execFileAsync(BB_CLI, ["thread", "list", "--archived", "--json"], { maxBuffer: 8_000_000 });
  const rows: unknown = JSON.parse(stdout);
  if (!Array.isArray(rows)) throw new Error("BB returned an invalid archived-thread list.");
  return rows.flatMap((row) => {
    if (!isRecord(row) || typeof row.id !== "string" || !row.id.startsWith("thr_") || typeof row.projectId !== "string") return [];
    const archivedAt = typeof row.archivedAt === "number" ? row.archivedAt : null;
    if (archivedAt === null || typeof row.deletedAt === "number") return [];
    return [{
      id: row.id,
      projectId: row.projectId,
      title: typeof row.title === "string" ? row.title : null,
      titleFallback: typeof row.titleFallback === "string" ? row.titleFallback : null,
      parentThreadId: typeof row.parentThreadId === "string" ? row.parentThreadId : null,
      environmentBranchName: typeof row.environmentBranchName === "string" ? row.environmentBranchName : null,
      isPinned: row.pinnedAt !== null,
      isUnread: false,
      createdAt: typeof row.createdAt === "number" ? row.createdAt : 0,
      updatedAt: typeof row.updatedAt === "number" ? row.updatedAt : archivedAt,
      archivedAt,
    }];
  });
}

async function sidebarArchivedThreads() {
  const lifecycle = runtime();
  const cached = lifecycle.archivedThreadsCache as { expiresAt: number; value: Awaited<ReturnType<typeof loadSidebarArchivedThreads>> } | null;
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (!lifecycle.archivedThreadsPending) lifecycle.archivedThreadsPending = loadSidebarArchivedThreads().then((value) => {
    if (!lifecycle.isDisposed) lifecycle.archivedThreadsCache = { value, expiresAt: Date.now() + 5 * 60_000 };
    return value;
  }).finally(() => { lifecycle.archivedThreadsPending = null; });
  return lifecycle.archivedThreadsPending as Promise<Awaited<ReturnType<typeof loadSidebarArchivedThreads>>>;
}

export default async function plugin(bb: BbPluginApi, lifecycle: ServerLifecycle = createServerLifecycle()) {
  // These caches are allocated by the factory, rather than at module load, so
  // a reload gets a fresh generation and disposal can release every handle.
  activeLifecycle = lifecycle;
  bb.onDispose(() => { lifecycle.dispose(); if (activeLifecycle === lifecycle) activeLifecycle = null; });
  const githubPollingSettings = bb.settings.define({
    githubActivePollSeconds: { type: "select", label: "Right Work PR polling", description: "How often to poll the visible right-side Work PR through GitHub REST.", options: ["30", "60", "120", "300"], default: "60" },
    githubBackgroundPollSeconds: { type: "select", label: "Right Work PR background polling", description: "How often to poll the right-side Work PR while BB is not visible.", options: ["120", "300", "600", "900"], default: "300" },
    githubLeftListRefreshSeconds: { type: "select", label: "Left PR list refresh", description: "How often to refresh authored pull requests and Stack membership in the left sidebar.", options: ["60", "120", "300", "600"], default: "300" },
    githubMaxRestPollsPerMinute: { type: "select", label: "Global REST poll budget", description: "Maximum fingerprint polls across all Work panels each minute.", options: ["10", "20", "30", "60"], default: "30" },
  });
  let lastGitHubFingerprintPollAt = 0;

  async function githubPollingPolicy() {
    const settings = await githubPollingSettings.get();
    return {
      activePollMs: Number(settings.githubActivePollSeconds) * 1_000,
      backgroundPollMs: Number(settings.githubBackgroundPollSeconds) * 1_000,
      maxRestPollsPerMinute: Number(settings.githubMaxRestPollsPerMinute),
    };
  }
  async function callPluginRpc<T>(pluginId: string, method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    // Cross-plugin RPC method names are runtime values, so the SDK cannot infer this input shape here.
    return bb.sdk.plugins.callRpc({ pluginId, method, input: input as never, outputSchema });
  }

  function tasksCall<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return callPluginRpc(TASKS_PLUGIN_ID, method, input, outputSchema);
  }

  async function taskboardCall<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return callPluginRpc(TASKBOARD_PLUGIN_ID, method, input, outputSchema);
  }

  async function githubStackCall<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return callPluginRpc(GITHUB_STACK_PLUGIN_ID, method, input, outputSchema);
  }

  function includeRemoteStackLayers(stack: z.infer<typeof ghStackPayloadSchema>["stack"], remoteStack: Awaited<ReturnType<typeof githubStack>>["stack"]) {
    if (!remoteStack) return stack;
    const remoteByNumber = new Map(remoteStack.pullRequests.map((pullRequest) => [pullRequest.number, pullRequest]));
    const existing = new Set(stack?.branches.flatMap((branch) => branch.pr ? [branch.pr.number] : []) ?? []);
    const remoteOnly = remoteStack.pullRequests.filter((pullRequest) => !existing.has(pullRequest.number));
    if (!stack) return {
      trunk: remoteStack.base,
      currentBranch: null,
      branches: remoteOnly.map((pullRequest) => ({
        name: pullRequest.head,
        isCurrent: false,
        isMerged: pullRequest.state.toLowerCase() === "merged",
        isQueued: false,
        needsRebase: false,
        hasStash: false,
        stashCount: null,
        pr: { number: pullRequest.number, url: pullRequest.url, state: pullRequest.state, title: pullRequest.title, isDraft: pullRequest.draft, metadataStale: false },
        diff: null,
        aheadOfRemote: null,
        behindRemote: null,
        checks: pullRequest.checks,
        review: pullRequest.review,
      })),
      trunkBehind: null,
      prunableBranchCount: null,
    };
    const branches = stack.branches.map((branch) => {
      const remote = branch.pr ? remoteByNumber.get(branch.pr.number) : undefined;
      if (!remote) return branch;
      const merged = remote.state.toLowerCase() === "merged";
      return {
        ...branch,
        isMerged: branch.isMerged || merged,
        pr: { ...branch.pr!, state: merged ? "merged" : branch.pr!.state, isDraft: remote.draft },
        checks: remote.checks,
        review: remote.review,
      };
    });
    if (remoteOnly.length === 0) return { ...stack, branches };
    return {
      ...stack,
      // The REST stack is ordered base-to-head. Missing entries are normally
      // merged layers at its base, so prepend them to the active local stack.
      branches: [...remoteOnly.map((pullRequest) => ({
        name: pullRequest.head,
        isCurrent: false,
        isMerged: pullRequest.state.toLowerCase() === "merged",
        isQueued: false,
        needsRebase: false,
        hasStash: false,
        stashCount: null,
        pr: { number: pullRequest.number, url: pullRequest.url, state: pullRequest.state, title: pullRequest.title, isDraft: pullRequest.draft, metadataStale: false },
        diff: null,
        aheadOfRemote: null,
        behindRemote: null,
        checks: pullRequest.checks,
        review: pullRequest.review,
      })), ...branches],
    };
  }

  async function enhancedGithubStack(threadId: string, remoteStack: Awaited<ReturnType<typeof githubStack>>["stack"]) {
    try {
      const payload = await githubStackCall("getStack", { threadId }, ghStackPayloadSchema);
      // A stack can still be available from the GitHub Stack plugin when BB's
      // environment PR lookup is transiently unavailable. In that case, use
      // any visible PR to fetch the canonical remote stack, including merged
      // base layers that the local plugin omits from its active projection.
      let resolvedRemoteStack = remoteStack;
      if (!resolvedRemoteStack) {
        const visiblePullRequest = payload.stack?.branches.find((branch) => branch.pr)?.pr ?? null;
        const match = visiblePullRequest?.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
        if (match) {
          try { resolvedRemoteStack = await fetchGitHubStack(match[1]!, match[2]!, Number(match[3]!)); }
          catch { /* The active stack remains useful when the REST fallback is unavailable. */ }
        }
      }
      const stack = includeRemoteStackLayers(payload.stack, resolvedRemoteStack);
      const firstPullRequest = stack?.branches.find((branch) => branch.pr)?.pr ?? null;
      const match = firstPullRequest?.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/\d+/);
      if (!stack || !match) return { stack, pending: payload.pending, error: payload.error?.message ?? null };
      const [, owner, repo] = match;
      const signals = await repositoryPullRequestSignals(owner, repo, stack.branches.flatMap((branch) => branch.pr ? [branch.pr.number] : []));
      return { stack: { ...stack, branches: stack.branches.map((branch) => ({
        ...branch,
        ...(branch.pr ? signals.get(branch.pr.number) ?? UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL : {}),
      })) }, pending: payload.pending, error: payload.error?.message ?? null };
    } catch (error) {
      // The optional gh-stack plugin should enrich the projection, never gate
      // it. The GitHub stack endpoint already gives us every layer (including
      // merged ancestors), so preserve that useful fallback when the local
      // stack integration is unavailable for this environment.
      const stack = includeRemoteStackLayers(null, remoteStack);
      return { stack, pending: null, error: stack ? null : error instanceof Error ? error.message : "GitHub Stack is unavailable." };
    }
  }

  async function pullRequestChanges(threadId: string) {
    const stackResult = await githubStack(threadId);
    const enhancedStack = await enhancedGithubStack(threadId, stackResult.stack);
    return { currentPullRequest: stackResult.currentPullRequest, stack: stackResult.stack, stackUnavailableReason: stackResult.reason, githubStack: enhancedStack };
  }
  async function workChanges(threadId: string, thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>, includePullRequests = true) {
    const repository = await repositorySummary(thread);
    if (!includePullRequests) return { currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository };
    return { ...(await pullRequestChanges(threadId)), repository };
  }

  async function workProviderStatus(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    try {
      const states = await bb.sdk.system.providerStates(thread.environmentId ? { environmentId: thread.environmentId } : {});
      const provider = states.providers.find((candidate) => candidate.providerId === thread.providerId);
      if (!provider) return { tone: "amber" as const, providerId: thread.providerId, providerName: thread.providerId, statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null, status: "unavailable" as const, message: "Provider health is not available from this host." };
      const tone = provider.status === "ready" ? "green" as const : provider.status === "unknown" ? "amber" as const : "red" as const;
      return { tone, providerId: thread.providerId, providerName: provider.displayName, statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null, status: provider.status, message: provider.statusMessage };
    } catch (error) {
      return { tone: "amber" as const, providerId: thread.providerId, providerName: thread.providerId, statusUrl: PROVIDER_STATUS_URLS[thread.providerId] ?? null, status: "unknown" as const, message: error instanceof Error ? error.message : "Provider health could not be checked." };
    }
  }

  async function readLinearLinks(): Promise<LinearLinks> {
    const value = await bb.storage.kv.get<unknown>(LINEAR_LINKS_KEY);
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([threadId, link]) =>
      threadId.startsWith("thr_") && isRecord(link) && typeof link.projectId === "string" && typeof link.locator === "string" && typeof link.key === "string"
        ? [[threadId, { projectId: link.projectId, locator: link.locator, key: link.key }]] : [],
    ));
  }

  async function trackerContext(rootThreadId: string, projectId: string, threadTitle: string): Promise<{ visible: boolean; available: boolean; message: string | null; suggestions: Array<{ key: string; title: string; url: string }>; item: z.infer<typeof trackerItemSchema> | null; statusOptions: z.infer<typeof trackerStatusOptionSchema>[] }> {
    const link = (await readLinearLinks())[rootThreadId];
    try {
      const suggestionsForThread = async () => {
        const matching = await taskboardCall("listItems", { projectId, source: "linear", query: threadTitle, limit: 8 }, z.object({ items: z.array(trackerItemSchema) }));
        if (matching.items.length > 0 || !threadTitle.trim()) return matching;
        // Keep the picker useful when no title words match: Taskboard's
        // unfiltered project list is its current/recent issue set.
        return taskboardCall("listItems", { projectId, source: "linear", query: "", limit: 8 }, z.object({ items: z.array(trackerItemSchema) }));
      };
      const suggestionRequest = suggestionsForThread();
      if (!link) {
        const { items } = await suggestionRequest;
        return { visible: true, available: true, message: null, suggestions: items.map(({ key, title, url }) => ({ key, title, url })), item: null, statusOptions: [] };
      }
      const [{ item }, { options }, { items }] = await Promise.all([
        taskboardCall("getItem", { projectId: link.projectId, source: "linear", locator: link.locator }, z.object({ item: trackerDetailSchema })),
        taskboardCall("statusOptions", { projectId: link.projectId, source: "linear", locator: link.locator }, z.object({ options: z.array(trackerStatusOptionSchema) })),
        suggestionRequest,
      ]);
      return { visible: true, available: true, message: null, suggestions: items.map(({ key, title, url }) => ({ key, title, url })), item, statusOptions: options };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Linear is unavailable.";
      const selectedElsewhere = /Linear is not the selected tracker/i.test(message);
      return { visible: !selectedElsewhere, available: false, message, suggestions: [], item: null, statusOptions: [] };
    }
  }

  function latestActivity(rows: readonly unknown[], latestAssistant: string | null, hasCurrentTurn: boolean) {
    const flattened: unknown[] = [];
    const visit = (items: readonly unknown[]) => items.forEach((item) => {
      flattened.push(item);
      if (isRecord(item) && Array.isArray(item.children)) visit(item.children);
    });
    visit(rows);
    type ActivityKind = "assistant" | "user" | "command" | "activity";
    type Activity = { text: string; kind: ActivityKind };
    const activity: Activity[] = [];
    for (const row of flattened) {
      if (!isRecord(row)) continue;
      if (row.kind === "conversation" && typeof row.text === "string" && row.text.trim()) {
        activity.push({ text: row.text.trim(), kind: row.role === "assistant" ? "assistant" : "user" });
      } else if (row.kind === "work" && row.workKind === "command" && typeof row.command === "string" && row.command.trim()) {
        activity.push({ text: row.command.trim(), kind: "command" });
      } else if (typeof row.text === "string" && row.text.trim()) {
        activity.push({ text: row.text.trim(), kind: "activity" });
      }
    }
    const compact = (entry: Activity | undefined) => entry ? { text: entry.text.slice(0, 360), kind: entry.kind } : null;
    const latest = activity.at(-1);
    let lastUser: Activity | undefined;
    let lastAssistant: Activity | undefined;
    for (let index = activity.length - 1; index >= 0; index -= 1) {
      if (activity[index]!.kind === "user") { lastUser = activity[index]; break; }
    }
    for (let index = activity.length - 1; index >= 0; index -= 1) {
      if (activity[index]!.kind === "assistant") { lastAssistant = activity[index]; break; }
    }
    return {
      // `threads.output` can be null while a newer turn is running; retain
      // the prior assistant message from the timeline instead of blanking it.
      latest: latestAssistant?.trim() ? { text: latestAssistant.trim().slice(0, 360), kind: "assistant" as const } : lastAssistant ? { text: lastAssistant.text.slice(0, 360), kind: "assistant" as const } : null,
      lastUser: lastUser ? { text: lastUser.text.slice(0, 360), kind: "user" as const } : null,
      current: hasCurrentTurn && lastUser ? { text: lastUser.text.slice(0, 360), kind: "user" as const } : null,
    };
  }

  async function tasksAvailable(): Promise<boolean> {
    try {
      return (await tasksCall("ping", null, z.object({ ok: z.literal(true), version: z.string() }))).ok;
    } catch { return false; }
  }

  async function listAllTasks(input: { activeOnly: boolean; sort: "manual" | "priority" | "due"; parentTaskId?: string }): Promise<Task[]> {
    const tasks: Task[] = [];
    let cursor: string | undefined;
    do {
      const page = await tasksCall(
        "listTasks",
        { activeOnly: input.activeOnly, sort: input.sort, limit: 500, ...(input.parentTaskId ? { parentTaskId: input.parentTaskId } : {}), ...(cursor ? { cursor } : {}) },
        taskPageSchema,
      );
      tasks.push(...page.tasks);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return tasks;
  }

  async function sidebarTasks() {
    const [tasks, assignees] = await Promise.all([listAllTasks({ activeOnly: true, sort: "priority" }), readTaskAssignees()]);
    const projects = (await tasksCall(
      "listProjects", {}, z.object({ projects: z.array(projectSchema) }),
    )).projects;
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const result = [];
    for (const task of tasks) {
      const threads = (await tasksCall(
        "listTaskThreads", { taskId: task.id },
        z.object({ taskThreads: z.array(taskThreadSchema) }),
      )).taskThreads;
      result.push(projectSidebarTask(task, projectNames.get(task.projectId) ?? "Work", threads.map((thread) => thread.threadId), assignees[task.id] ?? "human"));
    }
    return { tasks: result, projects: projects.map((project) => ({ id: project.id, name: project.name })) };
  }

  async function readBindings(): Promise<WorkBindings> { return normalizeBindings(await bb.storage.kv.get<unknown>(WORK_BINDINGS_KEY)); }
  async function writeBindings(bindings: WorkBindings) { await bb.storage.kv.set(WORK_BINDINGS_KEY, bindings); }
  async function readTaskAssignees(): Promise<Record<string, "agent" | "human">> {
    const value = await bb.storage.kv.get<unknown>(TASK_ASSIGNEES_KEY);
    if (!isRecord(value)) return {};
    return Object.fromEntries(Object.entries(value).flatMap(([taskId, assignee]) => typeof taskId === "string" && (assignee === "agent" || assignee === "human") ? [[taskId, assignee]] : []));
  }
  async function allTasksById() { return new Map((await listAllTasks({ activeOnly: false, sort: "manual" })).map((task) => [task.id, task])); }
  async function tasksProjects() { return (await tasksCall("listProjects", {}, z.object({ projects: z.array(projectSchema) }))).projects; }

  async function taskLinks() {
    const bindings = await readBindings();
    const [tasks, projects] = await Promise.all([allTasksById(), tasksProjects()]);
    const projectNames = new Map(projects.map((project) => [project.id, project.name]));
    const linked: Record<string, Array<{ task: TaskSummary; threadId: string; liveStatus: z.infer<typeof taskThreadSchema>["liveStatus"]; role: "outcome" | "execution"; mode: BindingMode | null; idempotencyKey: string | null; dispatchState: DispatchState | null }>> = {};
    const add = (threadId: string, task: Task, liveStatus: z.infer<typeof taskThreadSchema>["liveStatus"], role: "outcome" | "execution", mode: BindingMode | null, idempotencyKey: string | null, dispatchState: DispatchState | null) => {
      (linked[threadId] ??= []).push({ task: summarizeTask(task, projectNames.get(task.projectId) ?? "Work"), threadId, liveStatus, role, mode, idempotencyKey, dispatchState });
    };
    for (const outcome of bindings.outcomes) {
      const task = tasks.get(outcome.outcomeTaskId); if (!task) continue;
      const rows = await tasksCall("listTaskThreads", { taskId: task.id }, z.object({ taskThreads: z.array(taskThreadSchema) }));
      for (const row of rows.taskThreads.filter((row) => row.threadId === outcome.rootThreadId)) add(row.threadId, task, row.liveStatus, "outcome", null, null, null);
    }
    for (const execution of bindings.executions) {
      const task = tasks.get(execution.executionTaskId); if (!task || !execution.ownerThreadId) continue;
      const rows = await tasksCall("listTaskThreads", { taskId: task.id }, z.object({ taskThreads: z.array(taskThreadSchema) }));
      for (const row of rows.taskThreads.filter((row) => row.threadId === execution.ownerThreadId)) add(row.threadId, task, row.liveStatus, "execution", execution.mode, execution.idempotencyKey, execution.dispatchState);
    }
    return linked;
  }

  async function threadEnvironmentProjectId(thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>): Promise<string | null> {
    if (!thread.environmentId) return null;
    const environment = await bb.sdk.environments.get({ environmentId: thread.environmentId });
    return environment.projectId;
  }

  async function resolveTasksProject(thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>, options: { explicitTaskProjectId?: string | null; parentOutcome?: OutcomeBinding | null; binding?: OutcomeBinding | null; createIfMissing: boolean }): Promise<string> {
    const environmentProjectId = await threadEnvironmentProjectId(thread);
    const projects = await tasksProjects();
    const selected = resolveProjectSelection(projects, thread.projectId, {
      explicitTaskProjectId: options.explicitTaskProjectId,
      parentTaskProjectId: options.parentOutcome?.taskProjectId,
      bindingTaskProjectId: options.binding?.taskProjectId,
    }, environmentProjectId && environmentProjectId !== thread.projectId ? [environmentProjectId] : []);
    const selectedProject = selected ? projects.find((project) => project.id === selected) ?? null : null;
    if (environmentProjectId) assertThreadEnvironmentProject(thread.projectId, environmentProjectId, selectedProject?.linkedBbProjectId ? [selectedProject.linkedBbProjectId] : []);
    if (selected) return selected;
    if (!options.createIfMissing) throw new Error(`No Tasks project is linked to BB project ${thread.projectId}`);
    const bbProject = (await bb.sdk.projects.list({ includePersonal: true })).find((project) => project.id === thread.projectId);
    if (!bbProject) throw new Error(`BB project not found: ${thread.projectId}`);
    const created = await tasksCall("createProject", {
      name: bbProject.name, prefix: projectPrefix(bbProject.name, thread.projectId, new Set(projects.map((project) => project.prefix))),
      color: "blue", folderId: null, linkedBbProjectId: thread.projectId,
    }, z.object({ project: projectSchema }));
    const verified = (await tasksProjects()).filter((project) => project.linkedBbProjectId === thread.projectId);
    if (verified.length !== 1 || verified[0]!.id !== created.project.id) throw new Error(`Tasks project mapping changed while creating the mapping for ${thread.projectId}; resolve the duplicate mapping before retrying`);
    return created.project.id;
  }

  async function legacyContext(rootThreadId: string, threadProjectId: string) {
    const [tasks, projects] = await Promise.all([listAllTasks({ activeOnly: false, sort: "manual" }), tasksProjects()]);
    const candidates: Task[] = [];
    for (const task of tasks.filter((task) => task.parentTaskId === null)) {
      const rows = await tasksCall("listTaskThreads", { taskId: task.id }, z.object({ taskThreads: z.array(taskThreadSchema) }));
      if (rows.taskThreads.some((row) => row.threadId === rootThreadId)) candidates.push(task);
    }
    if (!candidates.length) return { state: "none" as const, taskIds: [], message: null };
    if (candidates.some((task) => projects.find((project) => project.id === task.projectId)?.linkedBbProjectId !== threadProjectId)) return { state: "project_mismatch" as const, taskIds: candidates.map((task) => task.id), message: "Legacy attachment is linked to a different BB project and cannot be adopted." };
    if (candidates.length !== 1) return { state: "ambiguous" as const, taskIds: candidates.map((task) => task.id), message: "Several legacy top-level tasks are attached; select one explicitly to adopt." };
    return { state: "adoptable" as const, taskIds: [candidates[0]!.id], message: "One legacy top-level attachment can be explicitly adopted." };
  }

  async function outcomeContext(input: { rootThreadId: string; title: string; description: string; taskProjectId?: string | null }) {
    if (!(await tasksAvailable())) throw new Error("The official BB Tasks plugin is not available");
    const root = await bb.sdk.threads.get({ threadId: input.rootThreadId });
    if (root.parentThreadId) throw new Error("Outcomes may only be created for a root work thread");
    const bindings = await readBindings();
    const existing = bindings.outcomes.find((binding) => binding.rootThreadId === root.id);
    const tasks = await allTasksById();
    if (existing) {
      const task = tasks.get(existing.outcomeTaskId);
      if (!task) throw new Error(`Outcome binding ${existing.outcomeTaskId} is missing; resolve recovery before creating another outcome`);
      assertOutcomeTaskBinding(existing, task);
      return { task, binding: existing };
    }
    const projectId = await resolveTasksProject(root, { explicitTaskProjectId: input.taskProjectId, createIfMissing: true });
    const result = await tasksCall("createTask", { projectId, title: input.title, description: input.description, status: "in_progress", priority: "medium", dueDate: null, parentTaskId: null, labelIds: [] }, z.union([z.object({ ok: z.literal(true), task: taskSchema }), z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) })]));
    if (!result.ok) throw new Error(result.error.message);
    if (result.task.parentTaskId !== null) throw new Error("Outcome creation returned a nested Tasks task; Work Sidebar outcomes must be top-level");
    if (result.task.projectId !== projectId) throw new Error(`Outcome creation returned project ${result.task.projectId}; expected ${projectId}`);
    await tasksCall("taskThreadsAttach", { taskId: result.task.id, threadId: root.id }, z.object({ threadId: z.string() }));
    const now = new Date().toISOString();
    const binding: OutcomeBinding = { kind: "outcome", rootThreadId: root.id, outcomeTaskId: result.task.id, taskProjectId: projectId, createdAt: now, updatedAt: now };
    await writeBindings({ ...bindings, outcomes: [...bindings.outcomes, binding] });
    return { task: result.task, binding };
  }

  async function createExecution(input: { rootThreadId: string; title: string; description: string; idempotencyKey: string }) {
    const root = await bb.sdk.threads.get({ threadId: input.rootThreadId });
    const bindings = await readBindings();
    const outcome = bindings.outcomes.find((binding) => binding.rootThreadId === root.id);
    if (!outcome) throw new Error("Ensure an outcome context before creating an execution task");
    const existing = bindings.executions.find((binding) => binding.rootThreadId === root.id && binding.idempotencyKey === input.idempotencyKey);
    const tasks = await allTasksById();
    if (existing) {
      const task = tasks.get(existing.executionTaskId);
      if (!task) throw new Error(`Execution binding ${existing.executionTaskId} is missing; recovery is required`);
      assertExecutionTaskBinding(existing, task);
      return { task, binding: existing, reused: true };
    }
    const outcomeTask = tasks.get(outcome.outcomeTaskId);
    if (!outcomeTask) throw new Error(`Outcome binding ${outcome.outcomeTaskId} is missing; recovery is required`);
    assertOutcomeTaskBinding(outcome, outcomeTask);
    const projectId = await resolveTasksProject(root, { parentOutcome: outcome, createIfMissing: false });
    if (projectId !== outcomeTask.projectId) throw new Error(`Outcome project mismatch: outcome task ${outcomeTask.id} is in ${outcomeTask.projectId}, expected ${projectId}`);
    const result = await tasksCall("createTask", { projectId, title: input.title, description: input.description, status: "todo", priority: "medium", dueDate: null, parentTaskId: outcome.outcomeTaskId, labelIds: [] }, z.union([z.object({ ok: z.literal(true), task: taskSchema }), z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) })]));
    if (!result.ok) throw new Error(result.error.message);
    if (result.task.parentTaskId !== outcome.outcomeTaskId) throw new Error("Execution task must be created as a direct child of the durable outcome");
    if (result.task.projectId !== projectId) throw new Error(`Execution creation returned project ${result.task.projectId}; expected ${projectId}`);
    const now = new Date().toISOString();
    const binding: ExecutionBinding = { kind: "execution", rootThreadId: root.id, outcomeTaskId: outcome.outcomeTaskId, taskProjectId: projectId, executionTaskId: result.task.id, ownerThreadId: null, mode: null, idempotencyKey: input.idempotencyKey, dispatchState: "ready", recoveryMessage: null, createdAt: now, updatedAt: now };
    await writeBindings({ ...bindings, executions: [...bindings.executions, binding] });
    return { task: result.task, binding, reused: false };
  }

  async function listDescendantThreads(parentThreadId: string, depth = 0): Promise<Array<{ thread: Awaited<ReturnType<typeof bb.sdk.threads.list>>[number]; depth: number }>> {
    if (depth >= 8) return [];
    const direct = await bb.sdk.threads.list({ parentThreadId, includeHidden: true, limit: 100 });
    const nested = await Promise.all(direct.map((child) => listDescendantThreads(child.id, depth + 1)));
    return [
      ...direct.map((thread) => ({ thread, depth: depth + 1 })),
      ...nested.flat(),
    ];
  }

  async function rootThread(threadId: string) {
    let thread = await bb.sdk.threads.get({ threadId });
    for (let depth = 0; thread.parentThreadId && depth < 32; depth += 1) thread = await bb.sdk.threads.get({ threadId: thread.parentThreadId });
    if (thread.parentThreadId) throw new Error("Thread parent chain is too deep to resolve a work root");
    return thread;
  }

  async function bindOwner(input: { rootThreadId: string; idempotencyKey: string; mode: BindingMode; prompt?: string; title?: string; visibility?: "visible" | "hidden" }) {
    const root = await bb.sdk.threads.get({ threadId: input.rootThreadId });
    const bindings = await readBindings();
    const index = bindings.executions.findIndex((binding) => binding.rootThreadId === root.id && binding.idempotencyKey === input.idempotencyKey);
    if (index < 0) throw new Error("Create or reuse the execution task before binding an owner");
    const current = bindings.executions[index]!;
    const dispatchProblem = executionBindingDispatchProblem(current);
    if (dispatchProblem) throw new Error(`Dispatch recovery is required: ${dispatchProblem}`);
    if (current.ownerThreadId) {
      if (current.mode !== input.mode) throw new Error(`Execution task is already bound in ${current.mode} mode`);
      return { binding: current, spawnedThreadId: current.mode === "delegated" ? current.ownerThreadId : null };
    }
    const save = async (binding: ExecutionBinding) => {
      const next = [...bindings.executions]; next[index] = binding;
      await writeBindings({ outcomes: bindings.outcomes, executions: next });
      return binding;
    };
    if (input.mode === "direct") {
      const pendingAttachment = await save(bindExecutionOwner(current, "direct", root.id, "pending_attachment", null));
      try {
        await tasksCall("taskThreadsAttach", { taskId: pendingAttachment.executionTaskId, threadId: root.id }, z.object({ threadId: z.string() }));
      } catch (error) {
        const uncertain = await save(bindExecutionOwner(pendingAttachment, "direct", root.id, "recovery_required", `Root thread ${root.id} could not be attached to execution task ${pendingAttachment.executionTaskId}: ${error instanceof Error ? error.message : String(error)}`));
        return { binding: uncertain, spawnedThreadId: null };
      }
      const ready = await save(bindExecutionOwner(pendingAttachment, "direct", root.id, "ready", null));
      bb.realtime.publish("work-sidebar:changed", { threadId: root.id });
      return { binding: ready, spawnedThreadId: null };
    }
    if (!input.prompt) throw new Error("Delegated execution requires a prompt");
    const pendingSpawn = await save(bindExecutionOwner(current, "delegated", null, "pending_spawn", null));
    let spawned: Awaited<ReturnType<typeof bb.sdk.threads.spawn>>;
    try {
      spawned = await bb.sdk.threads.spawn({
        projectId: root.projectId, parentThreadId: root.id, environment: root.environmentId ? { type: "reuse", environmentId: root.environmentId } : { type: "project-default" },
        prompt: input.prompt, title: input.title, visibility: input.visibility ?? "visible",
      });
    } catch (error) {
      const uncertain = await save(bindExecutionOwner(pendingSpawn, "delegated", null, "recovery_required", `Spawn may have completed but did not return: ${error instanceof Error ? error.message : String(error)}`));
      return { binding: uncertain, spawnedThreadId: null };
    }
    const pendingAttachment = await save(bindExecutionOwner(pendingSpawn, "delegated", spawned.id, "pending_attachment", null));
    try {
      await tasksCall("taskThreadsAttach", { taskId: pendingAttachment.executionTaskId, threadId: spawned.id }, z.object({ threadId: z.string() }));
    } catch (error) {
      const uncertain = await save(bindExecutionOwner(pendingAttachment, "delegated", spawned.id, "recovery_required", `Child thread ${spawned.id} was created but attachment did not complete: ${error instanceof Error ? error.message : String(error)}`));
      return { binding: uncertain, spawnedThreadId: spawned.id };
    }
    const ready = await save(bindExecutionOwner(pendingAttachment, "delegated", spawned.id, "ready", null));
    bb.realtime.publish("work-sidebar:changed", { threadId: root.id });
    return { binding: ready, spawnedThreadId: spawned.id };
  }

  function bindingSummary(binding: OutcomeBinding | ExecutionBinding) {
    return {
      rootThreadId: binding.rootThreadId, outcomeTaskId: binding.outcomeTaskId, taskProjectId: binding.taskProjectId,
      executionTaskId: binding.kind === "execution" ? binding.executionTaskId : null,
      ownerThreadId: binding.kind === "execution" ? binding.ownerThreadId : null,
      mode: binding.kind === "execution" ? binding.mode : null,
      idempotencyKey: binding.kind === "execution" ? binding.idempotencyKey : null,
      dispatchState: binding.kind === "execution" ? binding.dispatchState : "ready" as const,
      recoveryMessage: binding.kind === "execution" ? binding.recoveryMessage : null,
    };
  }

  async function githubStack(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) return { currentPullRequest: null, stack: null, reason: "This thread has no workspace branch." };
    let prResult;
    try {
      prResult = await bb.sdk.environments.pullRequest({ environmentId: thread.environmentId });
    } catch (error) {
      return {
        currentPullRequest: null,
        stack: null,
        reason: error instanceof Error ? `Pull request unavailable: ${error.message}` : "Pull request unavailable.",
      };
    }
    if (prResult.outcome !== "available") {
      return {
        currentPullRequest: null,
        stack: null,
        reason: prResult.outcome === "unavailable" ? prResult.message : "No GitHub pull request is linked to this branch.",
      };
    }
    const currentPullRequest = projectCurrentPullRequest({
      number: prResult.pullRequest.number,
      title: prResult.pullRequest.title,
      url: prResult.pullRequest.url,
      state: prResult.pullRequest.state,
      head: prResult.pullRequest.headRefName,
      base: prResult.pullRequest.baseRefName,
      checks: prResult.pullRequest.checks,
      review: prResult.pullRequest.review,
      attention: prResult.pullRequest.attention,
      mergeability: prResult.pullRequest.mergeability,
      signal: normalizePullRequestSignal({ checks: prResult.pullRequest.checks, review: prResult.pullRequest.review }),
    });
    const match = prResult.pullRequest.url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return { currentPullRequest, stack: null, reason: "The linked pull request is not hosted on GitHub." };
    const [, owner, repo] = match;
    try {
      const stack = await fetchGitHubStack(owner, repo, currentPullRequest.number);
      return stack
        ? { currentPullRequest, reason: null, stack }
        : { currentPullRequest, stack: null, reason: "This pull request is not part of a Stack." };
    } catch (error) {
      return {
        currentPullRequest,
        stack: null,
        reason: error instanceof Error ? `Stack information is unavailable: ${error.message}` : "Stack information is unavailable.",
      };
    }
  }

  async function pullRequestFingerprint(url: string) {
    const match = url.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) return { fingerprint: null };
    const [, owner, repo, number] = match;
    const policy = await githubPollingPolicy();
    // A single budget applies across split panels. If another PR was checked
    // very recently, skip this non-critical heartbeat rather than burst REST.
    if (Date.now() - lastGitHubFingerprintPollAt < 60_000 / policy.maxRestPollsPerMinute) return { fingerprint: null };
    lastGitHubFingerprintPollAt = Date.now();
    try {
      const stdout = await runCachedGitHubRead(["api", "--method", "GET", `repos/${owner}/${repo}/pulls/${number}`, "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], 2_000_000, 55_000);
      const value = JSON.parse(stdout) as unknown;
      if (!isRecord(value)) return { fingerprint: null };
      // This intentionally excludes presentation-only fields: a changed value
      // means the stack’s status or head may have changed and merits a full refresh.
      return { fingerprint: JSON.stringify([value.updated_at, value.state, value.merged, value.draft, isRecord(value.head) ? value.head.sha : null, value.mergeable_state]) };
    } catch { return { fingerprint: null }; }
  }

  async function sidebarThreadPullRequest(threadId: string) {
    const thread = await bb.sdk.threads.get({ threadId });
    if (!thread.environmentId) return null;
    const result = await bb.sdk.environments.pullRequest({ environmentId: thread.environmentId });
    if (result.outcome !== "available") return null;
    return {
      number: result.pullRequest.number,
      title: result.pullRequest.title,
      url: result.pullRequest.url,
      state: result.pullRequest.state,
      attention: result.pullRequest.attention,
    };
  }

  async function sidebarStackForThread(threadId: string): Promise<{ stack: SidebarStack | null; mergeTarget: string | null }> {
    const result = await githubStack(threadId);
    if (!result.stack) return { stack: null, mergeTarget: result.currentPullRequest?.base ?? null };
    const repository = result.stack.pullRequests[0]?.url.match(/^https?:\/\/[^/]+\/([^/]+\/[^/]+)\//i)?.[1] ?? threadId;
    return {
      stack: {
        id: `github-stack:${repository}:${result.stack.number}`,
        number: result.stack.number,
        base: result.stack.base,
        currentPullRequest: result.stack.currentPullRequest,
        pullRequests: result.stack.pullRequests.map((layer) => ({ ...layer })),
      },
      mergeTarget: result.currentPullRequest?.base ?? result.stack.base,
    };
  }

  async function repositorySummary(thread: Awaited<ReturnType<typeof bb.sdk.threads.get>>) {
    if (!thread.environmentId) return { outcome: "absent" as const, message: "This thread has no workspace.", branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] };
    try {
      const result = await bb.sdk.environments.status({ environmentId: thread.environmentId });
      if (result.outcome !== "available") return { outcome: result.outcome, message: "message" in result ? result.message : null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] };
      const { workspace } = result;
      const mergeBase = workspace.mergeBase;
      return {
        outcome: "available" as const, message: null,
        branch: workspace.branch.currentBranch ?? (workspace.checkout.kind === "branch" ? workspace.checkout.branchName : null),
        base: mergeBase?.mergeBaseBranch ?? workspace.branch.defaultBranch,
        ahead: mergeBase?.aheadCount ?? 0, behind: mergeBase?.behindCount ?? 0,
        worktreeState: workspace.workingTree.state,
        hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
        changedFileCount: workspace.workingTree.files.length,
        changedInsertions: workspace.workingTree.files.reduce((total, file) => total + (file.insertions ?? 0), 0),
        changedDeletions: workspace.workingTree.files.reduce((total, file) => total + (file.deletions ?? 0), 0),
        changedFiles: workspace.workingTree.files.slice(0, 8).map((file) => ({ path: file.path, status: file.status, insertions: file.insertions, deletions: file.deletions })),
      };
    } catch (error) {
      return { outcome: "unavailable" as const, message: error instanceof Error ? error.message : "Repository status is unavailable.", branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] };
    }
  }

  type AuthoredPullRequestEntry = { number: number; title: string; url: string; repository: string; state: "open" | "draft"; draft: boolean; head: string; base: string; checks: AuthoredPullRequestSignal["checks"]; review: AuthoredPullRequestSignal["review"]; reviewCommentCount: number; stack: SidebarStack | null };
  async function readAuthoredPullRequests() {
    // `gh search prs` is GitHub's account-wide authored-PR search, unlike
    // `gh pr list`, which is restricted to one checkout's repository.
    // GitHub search exposes at most 1,000 matches. Request that full window so
    // this is genuinely the user's account-wide open-PR list, not a 100-row
    // subset that happens to include the current checkout.
    const stdout = await runCachedGitHubRead(["search", "prs", "--author", "@me", "--state", "open", "--limit", "1000", "--json", "number,title,url,repository,state,isDraft"], 12_000_000, GITHUB_SEARCH_CACHE_MS);
    const search = parseAuthoredPullRequestSearch(JSON.parse(stdout));
    const signals = await authoredPullRequestSignals(search);
    return search.flatMap((item): AuthoredPullRequestEntry[] => {
      if (!item.repository.nameWithOwner) return [];
      const repository = item.repository.nameWithOwner!;
      const signal = signals.get(`${repository}#${item.number}`) ?? UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL;
      return [{ number: item.number, title: item.title, url: item.url, repository, state: item.isDraft ? "draft" as const : "open" as const, draft: item.isDraft === true, head: "", base: "", checks: signal.checks, review: signal.review, reviewCommentCount: 0, stack: null }];
    });
  }
  async function readAuthoredPullRequestStacks(base: AuthoredPullRequestEntry[]) {
    const byPullRequest = new Map(base.map((item) => [`${item.repository}#${item.number}`, item]));
    const describe = async (item: AuthoredPullRequestEntry): Promise<AuthoredPullRequestEntry> => {
      try {
        const stdout = await runCachedGitHubRead(["api", "--method", "GET", `repos/${item.repository}/stacks`, "-f", `pull_request=${item.number}`, "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], 2_000_000);
        const raw = parseGitHubStackResponse(JSON.parse(stdout));
        if (!raw) return item;
        const [owner, repo] = item.repository.split("/", 2);
        const signals = owner && repo ? await repositoryPullRequestSignals(owner, repo, raw.pull_requests.map((layer) => layer.number)) : new Map<number, AuthoredPullRequestSignal>();
        const pullRequests = raw.pull_requests.flatMap((layer) => {
          const known = byPullRequest.get(`${item.repository}#${layer.number}`);
          return known ? [{ ...known, head: layer.head, base: layer.base || raw.base, ...(signals.get(layer.number) ?? {}) }] : [];
        });
        return pullRequests.length ? { ...item, stack: { id: `github-stack:${item.repository}:${raw.number}`, number: raw.number, base: raw.base, currentPullRequest: item.number, pullRequests } } : item;
      } catch { return item; }
    };
    const result: AuthoredPullRequestEntry[] = [];
    for (let start = 0; start < base.length; start += 4) result.push(...await Promise.all(base.slice(start, start + 4).map(describe)));
    bb.log.info(`resolved ${result.length} authored PRs; ${result.filter((pullRequest) => pullRequest.stack).length} Stack memberships`);
    return result;
  }
  const authoredPullRequestService = createPullRequestService<AuthoredPullRequestEntry>({
    now: () => Date.now(),
    readAuthored: readAuthoredPullRequests,
    readStacks: readAuthoredPullRequestStacks,
    archivedRepositories: async (items) => archivedGitHubRepositories(items.map((item) => item.repository)),
    setDraft: async (url, draft) => {
      await execFileAsync("gh", ["pr", "ready", url, ...(draft ? ["--undo"] : [])], { maxBuffer: 1_000_000 });
      clearGitHubReadCache();
      return { draft };
    },
  });
  bb.onDispose(() => authoredPullRequestService.dispose());

  bb.rpc.register(rpcContract, {
    async getGitHubApiHealth() { return githubReadHealth(); },
    async getSidebarOrder() {
      return { threadIds: sanitizeThreadOrder(await bb.storage.kv.get<unknown>(SIDEBAR_ORDER_KEY)) };
    },
    async getThreadListMode() {
      const value = await bb.storage.kv.get<unknown>(THREAD_LIST_MODE_KEY);
      return { mode: value === "native" ? "native" as const : "enhanced" as const };
    },
    async saveThreadListMode({ mode }) {
      await bb.storage.kv.set(THREAD_LIST_MODE_KEY, mode);
      return { mode };
    },
    async saveSiblingOrder({ threadIds }) {
      const sanitized = sanitizeThreadOrder(threadIds);
      await bb.storage.kv.set(SIDEBAR_ORDER_KEY, sanitized);
      bb.realtime.publish(SIDEBAR_ORDER_CHANNEL, { threadIds: sanitized });
      return { threadIds: sanitized };
    },
    async getLaterThreads() {
      return { threadIds: sanitizeThreadOrder(await bb.storage.kv.get<unknown>(LATER_THREADS_KEY)) };
    },
    async saveLaterThreads({ threadIds }) {
      const sanitized = sanitizeThreadOrder(threadIds);
      await bb.storage.kv.set(LATER_THREADS_KEY, sanitized);
      bb.realtime.publish(SIDEBAR_ORDER_CHANNEL, { threadIds: sanitized });
      return { threadIds: sanitized };
    },
    async getThreadGroups() {
      const [savedGroups, legacyLater] = await Promise.all([
        bb.storage.kv.get<unknown>(THREAD_GROUPS_KEY),
        bb.storage.kv.get<unknown>(LATER_THREADS_KEY),
      ]);
      return { groups: normalizeThreadGroups(savedGroups, legacyLater) };
    },
    async saveThreadGroups({ groups }) {
      const normalized = normalizeThreadGroups({ groups });
      await bb.storage.kv.set(THREAD_GROUPS_KEY, { groups: normalized });
      bb.realtime.publish(SIDEBAR_ORDER_CHANNEL, { groups: normalized });
      return { groups: normalized };
    },
    async sidebarTasks() {
      try {
        if (!(await tasksAvailable())) return { available: false, tasks: [], projects: [], error: null };
        const result = await sidebarTasks();
        return { available: true, ...result, error: null };
      } catch (error) {
        return { available: false, tasks: [], projects: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarTaskLinks() {
      try {
        if (!(await tasksAvailable())) return { available: false, links: {}, error: null };
        return { available: true, links: await taskLinks(), error: null };
      } catch (error) {
        return { available: false, links: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarPullRequestStacks({ threadIds }) {
      try {
        const entries = await Promise.all([...new Set(threadIds)].map(async (threadId) => [threadId, await sidebarStackForThread(threadId)] as const));
        return {
          available: true,
          stacks: Object.fromEntries(entries.flatMap(([threadId, result]) => result.stack ? [[threadId, result.stack] as const] : [])),
          mergeTargets: Object.fromEntries(entries.flatMap(([threadId, result]) => result.mergeTarget ? [[threadId, result.mergeTarget] as const] : [])),
          error: null,
        };
      } catch (error) {
        return { available: false, stacks: {}, mergeTargets: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarThreadPullRequests({ threadIds }) {
      try {
        const pullRequests: Record<string, Awaited<ReturnType<typeof sidebarThreadPullRequest>>> = {};
        const unique = [...new Set(threadIds)];
        for (let offset = 0; offset < unique.length; offset += 12) {
          const batch = unique.slice(offset, offset + 12);
          const entries = await Promise.all(batch.map(async (threadId) => {
            try { return [threadId, await sidebarThreadPullRequest(threadId)] as const; }
            // A retired or otherwise unavailable environment has no PR to
            // refresh. Keep healthy rows refreshing instead of failing all.
            catch { return [threadId, null] as const; }
          }));
          for (const [threadId, pullRequest] of entries) pullRequests[threadId] = pullRequest;
        }
        return { available: true, pullRequests, error: null };
      } catch (error) {
        return { available: false, pullRequests: {}, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarAuthoredPullRequests({ force }) {
      try {
        if (force) { authoredPullRequestService.clear(); clearGitHubReadCache(); }
        return { available: true, pullRequests: await authoredPullRequestService.authored(), error: null };
      } catch (error) {
        return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarAuthoredPullRequestStacks() {
      try {
        return { available: true, pullRequests: await authoredPullRequestService.stacks(), error: null };
      } catch (error) {
        return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async setAuthoredPullRequestDraft({ url, draft }) {
      return authoredPullRequestService.setDraft(url, draft);
    },
    async sidebarArchivedThreads({ force }) {
      try {
        if (force) runtime().archivedThreadsCache = null;
        return { available: true, threads: await sidebarArchivedThreads(), error: null };
      } catch (error) {
        return { available: false, threads: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async unarchiveSidebarThread({ threadId }) {
      await execFileAsync(BB_CLI, ["thread", "unarchive", threadId], { maxBuffer: 1_000_000 });
      runtime().archivedThreadsCache = null;
      return { threadId };
    },
    async getWorkContext({ threadId }) {
      // Keep this request to data required by every tab. Repository, GitHub
      // Stack, and tracker queries are independently loaded by their cards.
      const [thread, available, timeline, children, root, bindings, latestOutput] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        tasksAvailable(),
        bb.sdk.threads.timeline({ threadId }),
        listDescendantThreads(threadId),
        rootThread(threadId),
        readBindings(),
        bb.sdk.threads.output({ threadId }),
      ]);
      const links = available ? await taskLinks() : {};
      const outcomeBinding = bindings.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
      const [tasksById, projects] = available ? await Promise.all([allTasksById(), tasksProjects()]) : [new Map<string, Task>(), [] as z.infer<typeof projectSchema>[]];
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      const outcomeTask = outcomeBinding ? tasksById.get(outcomeBinding.outcomeTaskId) ?? null : null;
      const executionBindings = bindings.executions.filter((binding) => binding.rootThreadId === root.id);
      const executionTasks = executionBindings.flatMap((binding) => {
        const task = tasksById.get(binding.executionTaskId);
        return task ? [summarizeTask(task, projectNames.get(task.projectId) ?? "Work")] : [];
      });
      return {
        tasksAvailable: available,
        currentThread: {
          title: thread.title ?? thread.titleFallback ?? "Untitled thread",
          status: thread.status,
          runtimeStatus: thread.runtime.displayStatus,
          providerId: thread.providerId,
        },
        tasks: outcomeTask ? [summarizeTask(outcomeTask, projectNames.get(outcomeTask.projectId) ?? "Work")] : [],
        subtasks: executionTasks,
        outcome: outcomeTask ? summarizeTask(outcomeTask, projectNames.get(outcomeTask.projectId) ?? "Work") : null,
        executionTasks,
        bindings: [
          ...(outcomeBinding ? [bindingSummary(outcomeBinding)] : []),
          ...executionBindings.map(bindingSummary),
        ],
        // Legacy adoption is handled only by its explicit command. Scanning
        // every historical task attachment here made opening Work needlessly slow.
        legacy: { state: "none" as const, taskIds: [], message: null },
        goal: timeline.goal ? {
          objective: timeline.goal.objective, status: timeline.goal.status,
          tokensUsed: timeline.goal.tokensUsed, tokenBudget: timeline.goal.tokenBudget,
          timeUsedSeconds: timeline.goal.timeUsedSeconds,
        } : null,
        todos: timeline.pendingTodos?.items ?? [],
        activity: latestActivity(timeline.rows, latestOutput.output, thread.status === "active" || thread.status === "starting"),
        children: children.map(({ thread: child, depth }) => ({
          id: child.id, title: child.title ?? child.titleFallback ?? "Untitled agent", depth,
          status: child.status, runtimeStatus: child.runtime.displayStatus, providerId: child.providerId, isArchived: child.archivedAt !== null,
          task: links[child.id]?.[0] ? {
            key: links[child.id]![0].task.key,
            status: links[child.id]![0].task.status,
            liveStatus: links[child.id]![0].liveStatus,
          } : null,
        })),
        currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null,
        repository: { outcome: "absent" as const, message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] },
        tracker: { visible: false, available: false, message: null, suggestions: [], item: null, statusOptions: [] },
      };
    },
    async getWorkChanges({ threadId, force, pullRequests }) {
      if (force) clearGitHubReadCache();
      const thread = await bb.sdk.threads.get({ threadId });
      return workChanges(threadId, thread, pullRequests !== false);
    },
    async getThreadPullRequestChanges({ threadId }) { return pullRequestChanges(threadId); },
    async getPullRequestFingerprint({ url }) { return pullRequestFingerprint(url); },
    async getGitHubPollingPolicy() { return githubPollingPolicy(); },
    async getWorkTracker({ threadId }) {
      const [thread, root] = await Promise.all([bb.sdk.threads.get({ threadId }), rootThread(threadId)]);
      return trackerContext(root.id, root.projectId, thread.title ?? thread.titleFallback ?? "");
    },
    async getWorkProviderStatus({ threadId }) {
      return workProviderStatus(threadId);
    },
    async checkoutStackBranch({ threadId, branch }) {
      return githubStackCall("checkoutBranch", { threadId, branch }, ghStackActionSchema);
    },
    async linkLinearIssue({ threadId, key }) {
      const root = await rootThread(threadId);
      const normalizedKey = key.trim().toUpperCase();
      const projectId = root.projectId;
      const { items } = await taskboardCall("listItems", { projectId, source: "linear", query: normalizedKey, limit: 30 }, z.object({ items: z.array(trackerItemSchema) }));
      const item = items.find((candidate) => candidate.key.toUpperCase() === normalizedKey);
      if (!item) throw new Error(`No Linear issue matching ${normalizedKey} was found in this BB project.`);
      const links = await readLinearLinks();
      await bb.storage.kv.set(LINEAR_LINKS_KEY, { ...links, [root.id]: { projectId, locator: item.locator, key: item.key } });
      bb.realtime.publish("work-sidebar:changed", { threadId: root.id });
      return { key: item.key, title: item.title };
    },
    async searchLinearIssues({ threadId, query }) {
      const root = await rootThread(threadId);
      const normalizedQuery = query.trim();
      if (!normalizedQuery) return { items: [] };
      const { items } = await taskboardCall("listItems", { projectId: root.projectId, source: "linear", query: normalizedQuery, limit: 20 }, z.object({ items: z.array(trackerItemSchema) }));
      return { items: items.map(({ key, title, url }) => ({ key, title, url })) };
    },
    async getLatestActivity({ threadId }) {
      const [thread, timeline, output] = await Promise.all([
        bb.sdk.threads.get({ threadId }),
        bb.sdk.threads.timeline({ threadId }),
        bb.sdk.threads.output({ threadId }),
      ]);
      return {
        currentThread: { status: thread.status, runtimeStatus: thread.runtime.displayStatus },
        ...latestActivity(timeline.rows, output.output, thread.status === "active" || thread.status === "starting"),
      };
    },
    async getWorkingTreeFileDiff({ threadId, path }) {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) return { available: false, patch: null, message: "This thread has no workspace." };
      const result = await bb.sdk.environments.diffPatch({ environmentId: thread.environmentId, target: { type: "uncommitted" }, paths: [path] });
      if (result.outcome !== "available") return { available: false, patch: null, message: "message" in result ? result.message : result.failure.message };
      return { available: true, patch: result.patches[0]?.patch ?? null, message: result.patches[0] ? null : "No diff is available for this file." };
    },
    async unlinkLinearIssue({ threadId }) {
      const root = await rootThread(threadId);
      const links = await readLinearLinks();
      delete links[root.id];
      await bb.storage.kv.set(LINEAR_LINKS_KEY, links);
      bb.realtime.publish("work-sidebar:changed", { threadId: root.id });
      return { ok: true as const };
    },
    async updateLinearIssueStatus({ threadId, statusId }) {
      const root = await rootThread(threadId);
      const link = (await readLinearLinks())[root.id];
      if (!link) throw new Error("Link a Linear issue before changing its status.");
      const { item } = await taskboardCall("updateItemStatus", { projectId: link.projectId, source: "linear", locator: link.locator, statusId }, z.object({ item: trackerItemSchema }));
      bb.realtime.publish("work-sidebar:changed", { threadId: root.id });
      return { key: item.key, status: item.status };
    },
    async createWorkTask(input) {
      if (input.parentTaskId) throw new Error("Work Sidebar outcomes must be top-level; create execution tasks through createExecutionTask instead");
      const root = await rootThread(input.threadId);
      const result = await outcomeContext({ rootThreadId: root.id, title: input.title, description: input.description, taskProjectId: input.taskProjectId });
      const projects = await tasksProjects();
      return { task: summarizeTask(result.task, projects.find((project) => project.id === result.task.projectId)?.name ?? "Work") };
    },
    async ensureOutcomeContext(input) {
      const result = await outcomeContext(input);
      const projects = await tasksProjects();
      return { task: summarizeTask(result.task, projects.find((project) => project.id === result.task.projectId)?.name ?? "Work"), binding: bindingSummary(result.binding) };
    },
    async createExecutionTask(input) {
      const result = await createExecution(input);
      const projects = await tasksProjects();
      return { task: summarizeTask(result.task, projects.find((project) => project.id === result.task.projectId)?.name ?? "Work"), binding: bindingSummary(result.binding), reused: result.reused };
    },
    async bindExecutionOwner(input) {
      const result = await bindOwner(input);
      return { binding: bindingSummary(result.binding), spawnedThreadId: result.spawnedThreadId };
    },
    async adoptLegacyOutcome({ rootThreadId, taskId }) {
      const root = await rootThread(rootThreadId);
      const bindings = await readBindings();
      if (bindings.outcomes.some((binding) => binding.rootThreadId === root.id)) throw new Error("A durable outcome binding already exists for this root thread");
      const legacy = await legacyContext(root.id, root.projectId);
      if (legacy.state !== "adoptable" || legacy.taskIds[0] !== taskId) throw new Error(legacy.message ?? "This legacy task cannot be adopted unambiguously");
      const task = (await allTasksById()).get(taskId);
      if (!task || task.parentTaskId !== null) throw new Error("Only an unambiguous top-level legacy task can be adopted as an outcome");
      const now = new Date().toISOString();
      const binding: OutcomeBinding = { kind: "outcome", rootThreadId: root.id, outcomeTaskId: task.id, taskProjectId: task.projectId, createdAt: now, updatedAt: now };
      await writeBindings({ ...bindings, outcomes: [...bindings.outcomes, binding] });
      const projects = await tasksProjects();
      return { task: summarizeTask(task, projects.find((project) => project.id === task.projectId)?.name ?? "Work"), binding: bindingSummary(binding) };
    },
    async updateWorkTask({ taskId, status }) {
      const result = await tasksCall(
        "updateTask", { taskId, status, authorName: "Work Sidebar" },
        z.union([
          z.object({ ok: z.literal(true), task: taskSchema }),
          z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
        ]),
      );
      if (!result.ok) throw new Error(result.error.message);
      return { task: summarizeTask(result.task) };
    },
    async updateTaskStatus({ taskId, status }) {
      const result = await tasksCall(
        "updateTask", { taskId, status, authorName: "Work Sidebar" },
        z.union([
          z.object({ ok: z.literal(true), task: taskSchema }),
          z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
        ]),
      );
      if (!result.ok) throw new Error(result.error.message);
      return { task: summarizeTask(result.task) };
    },
    async updateTaskAssignee({ taskId, assignee }) {
      const assignees = await readTaskAssignees();
      await bb.storage.kv.set(TASK_ASSIGNEES_KEY, { ...assignees, [taskId]: assignee });
      return { taskId, assignee };
    },
    async createSidebarTask({ projectId, title, assignee }) {
      const result = await tasksCall(
        "createTask", { projectId, title, description: "", status: "todo", priority: "medium", dueDate: null, parentTaskId: null, labelIds: [] },
        z.union([z.object({ ok: z.literal(true), task: taskSchema }), z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) })]),
      );
      if (!result.ok) throw new Error(result.error.message);
      const assignees = await readTaskAssignees();
      await bb.storage.kv.set(TASK_ASSIGNEES_KEY, { ...assignees, [result.task.id]: assignee });
      const projects = await tasksProjects();
      return { task: projectSidebarTask(result.task, projects.find((project) => project.id === projectId)?.name ?? "Work", [], assignee) };
    },
    async deleteSidebarTask({ taskId }) {
      const bindings = await readBindings();
      if (bindings.outcomes.some((binding) => binding.outcomeTaskId === taskId) || bindings.executions.some((binding) => binding.executionTaskId === taskId)) {
        throw new Error("This task is part of a durable work binding and cannot be deleted from the sidebar.");
      }
      const result = await tasksCall("deleteTask", { taskId }, z.object({ deleted: z.boolean() }));
      if (result.deleted) {
        const assignees = await readTaskAssignees();
        if (taskId in assignees) {
          const { [taskId]: _removed, ...remaining } = assignees;
          await bb.storage.kv.set(TASK_ASSIGNEES_KEY, remaining);
        }
      }
      return result;
    },
    async attachTaskToThread({ taskId, threadId }) {
      return tasksCall("taskThreadsAttach", { taskId, threadId }, z.object({ threadId: taskThreadIdSchema }));
    },
    async detachTaskFromThread({ taskId, threadId }) {
      return tasksCall("taskThreadsDetach", { taskId, threadId }, z.object({ threadId: taskThreadIdSchema }));
    },
    async reorderTask({ taskId, beforeTaskId, afterTaskId }) {
      const current = (await tasksCall("getTask", { taskId }, z.object({ task: taskSchema.nullable() }))).task;
      if (!current) throw new Error(`Task not found: ${taskId}`);
      for (const neighborId of [beforeTaskId, afterTaskId]) {
        if (!neighborId) continue;
        const neighbor = (await tasksCall("getTask", { taskId: neighborId }, z.object({ task: taskSchema.nullable() }))).task;
        if (!neighbor || neighbor.projectId !== current.projectId || neighbor.status !== current.status || neighbor.parentTaskId !== current.parentTaskId) throw new Error("Tasks can only be reordered among same-project, same-status siblings");
      }
      const result = await tasksCall("boardMove", { taskId, status: current.status, beforeTaskId, afterTaskId, authorName: "Work Sidebar" }, z.union([
        z.object({ ok: z.literal(true), task: taskSchema }),
        z.object({ ok: z.literal(false), error: z.object({ code: z.string(), message: z.string() }) }),
      ]));
      if (!result.ok) throw new Error(result.error.message);
      return { task: summarizeTask(result.task) };
    },
  });

  bb.agents.registerTool({
    name: "create_work_task",
    description: "Ensure the one top-level outcome task for the current root work item.",
    parameters: z.object({
      title: z.string().trim().min(1).describe("Concise outcome-oriented task title"),
      description: z.string().describe("Context and acceptance criteria for the work"),
      taskProjectId: z.string().nullable().optional().describe("Explicit Tasks project only when it is linked to this BB project"),
    }),
    instructions: "Call get_work_context first. Outcomes are top-level only; execution units are direct children created with create_execution_task.",
    async execute(params, context) {
      const root = await rootThread(context.threadId);
      const result = await outcomeContext({ rootThreadId: root.id, title: params.title, description: params.description, taskProjectId: params.taskProjectId });
      const task = summarizeTask(result.task);
      return `Work is tracked as ${task.key}: ${task.title}. Work through this task, record meaningful milestones with bb tasks comment, and set it to in_review after validation.`;
    },
  });

  bb.agents.registerTool({
    name: "get_work_context",
    description: "Read durable outcome, execution, ownership, recovery, and legacy-adoption context for the current work root.",
    parameters: z.object({ rootThreadId: z.string().optional() }),
    instructions: "Use at start, resume, and after compaction before creating tasks, dispatching work, or changing task status. This is a lookup tool, not a compaction hook.",
    async execute(params, context) {
      const root = await rootThread(params.rootThreadId ?? context.threadId);
      const bindings = await readBindings();
      const outcome = bindings.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
      const legacy = outcome ? { state: "none", taskIds: [], message: null } : await legacyContext(root.id, root.projectId);
      return JSON.stringify({ rootThreadId: root.id, outcome, executions: bindings.executions.filter((binding) => binding.rootThreadId === root.id), legacy });
    },
  });

  bb.agents.registerTool({
    name: "create_execution_task",
    description: "Create or reuse one direct execution subtask using a stable idempotency key.",
    parameters: z.object({ rootThreadId: z.string().optional(), title: z.string().trim().min(1), description: z.string().default(""), idempotencyKey: z.string().trim().min(1).max(200) }),
    instructions: "Call get_work_context first. This creates only a direct child of the durable top-level outcome; never create nested Tasks subtasks.",
    async execute(params, context) {
      const root = await rootThread(params.rootThreadId ?? context.threadId);
      const result = await createExecution({ ...params, rootThreadId: root.id });
      return `${result.reused ? "Reused" : "Created"} execution task ${result.task.key} with idempotency key ${result.binding.idempotencyKey}.`;
    },
  });

  bb.agents.registerTool({
    name: "bind_execution_owner",
    description: "Bind a direct root owner or dispatch one delegated child owner for an execution task.",
    parameters: z.object({ rootThreadId: z.string().optional(), idempotencyKey: z.string().trim().min(1).max(200), mode: z.enum(["direct", "delegated"]), prompt: z.string().trim().min(1).optional(), title: z.string().trim().min(1).optional(), visibility: z.enum(["visible", "hidden"]).optional() }),
    instructions: "Call get_work_context first. Delegated dispatch persists pending state before spawn; if recovery is required, do not retry automatically.",
    async execute(params, context) {
      const root = await rootThread(params.rootThreadId ?? context.threadId);
      const result = await bindOwner({ ...params, rootThreadId: root.id });
      return JSON.stringify({ binding: bindingSummary(result.binding), spawnedThreadId: result.spawnedThreadId });
    },
  });

  bb.agents.registerTool({
    name: "get_sidebar_tasks",
    description: "List the active BB Tasks items and their Human or Agent assignment.",
    parameters: z.object({}).strict(),
    instructions: "Use this when the user asks to check tasks, task assignments, or the task queue. It reads BB Tasks, not a repository TODO file.",
    async execute() {
      if (!(await tasksAvailable())) throw new Error("The BB Tasks plugin is unavailable.");
      const { tasks } = await sidebarTasks();
      return JSON.stringify({ tasks: tasks.map(({ key, title, status, priority, assignee, linkedThreadIds }) => ({ key, title, status, priority, assignee, linkedThreadIds })) });
    },
  });

  bb.agents.configure(() => ({
    tools: ["get_sidebar_tasks", "get_work_context", "create_work_task", "create_execution_task", "bind_execution_owner"], skills: [],
    instructions: "Use BB Tasks as the source of truth for all work tracking. When asked to check tasks, use get_sidebar_tasks (or the BB Tasks skill), never a repository TODO file as the task source. Create or attach the durable top-level outcome before substantive work, and create direct execution tasks for distinct agent work. Treat Human-assigned tasks as user-owned and do not work them unless the user explicitly delegates them; Agent-assigned tasks are eligible for agent work. Before task creation, dispatch, or status change, call get_work_context at start/resume/after compaction. It reads durable bindings; no automatic compaction hook exists. Keep one top-level outcome per root work item, with execution tasks as direct children only. Bind direct work to the root or delegated work to one spawned child. Pending/recovery dispatch states require explicit reconciliation; never retry an uncertain spawn automatically. Task lifecycle is explicit: thread idle/completion never promotes a task.",
  }));

  bb.log.info("Work Sidebar backend loaded");
}

export { rpcContract } from "./contracts.js";
export { createServerLifecycle } from "./server-lifecycle.js";
