import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { rpcContract } from "./contracts.js";
import { sanitizeThreadOrder, type SidebarStack } from "./work-model.js";

const execFileAsync = promisify(execFile);
const TASKS_PLUGIN_ID = "tasks";
const SIDEBAR_ORDER_KEY = "sidebar-thread-order:v1";
const LATER_THREADS_KEY = "sidebar-later-threads:v1";
const WORK_BINDINGS_KEY = "work-bindings:v2";
export const SIDEBAR_ORDER_CHANNEL = "sidebar-order:changed";
export const GITHUB_STACK_API_VERSION = "2026-03-10";
export const GITHUB_ACCEPT_HEADER = "application/vnd.github+json";
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
}

interface StackPullRequest {
  number: number;
  state: string;
  draft: boolean;
  head: string;
  base: string;
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
  draft?: boolean;
  head?: { ref?: string };
  base?: { ref?: string };
}

export type GitHubApiRunner = (args: readonly string[], maxBuffer: number) => Promise<string>;

const runGitHubApi: GitHubApiRunner = async (args, maxBuffer) => {
  const { stdout } = await execFileAsync("gh", [...args], { maxBuffer });
  return stdout;
};

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

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`GitHub Stack response has invalid ${field}`);
  return value;
}

function requiredNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) throw new Error(`GitHub Stack response has invalid ${field}`);
  return value;
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
  number: number; title: string; state: string; draft: boolean; url: string; head: string; base: string;
}> } | null> {
  const raw = parseGitHubStackResponse(JSON.parse(await run(githubStackApiArgs(owner, repo, pullRequest), 4_000_000)));
  if (!raw) return null;
  const pullRequests = await Promise.all(raw.pull_requests.map(async (pr) => {
    try {
      const details = JSON.parse(await run([
        "api", "--method", "GET", `repos/${owner}/${repo}/pulls/${pr.number}`,
        "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`,
        "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`,
      ], 2_000_000)) as { title?: string; html_url?: string; state?: string; draft?: boolean; head?: { ref?: string }; base?: { ref?: string } };
      return {
        number: pr.number,
        title: details.title ?? `Pull request #${pr.number}`,
        state: details.state ?? pr.state,
        draft: details.draft ?? pr.draft,
        url: details.html_url ?? `https://github.com/${owner}/${repo}/pull/${pr.number}`,
        head: details.head?.ref ?? pr.head,
        base: details.base?.ref ?? pr.base,
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
      };
    }
  }));
  return { number: raw.number, base: raw.base, currentPullRequest: pullRequest, pullRequests };
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
      const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", `query=query { ${selections} }`], { maxBuffer: 2_000_000 });
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
  checks: "failed" | "passing" | "pending" | "none";
  review: "approved" | "changes_requested" | "review_requested" | "review_required" | "none";
};
const UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL: AuthoredPullRequestSignal = { checks: "none", review: "none" };

/** Fetch the concise CI and review summaries shown beside account-wide PRs. */
async function authoredPullRequestSignals(items: readonly GitHubSearchPullRequest[]): Promise<Map<string, AuthoredPullRequestSignal>> {
  const signals = new Map<string, AuthoredPullRequestSignal>();
  for (let start = 0; start < items.length; start += 50) {
    const batch = items.slice(start, start + 50);
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
      const { stdout } = await execFileAsync("gh", ["api", "graphql", "-f", `query=query { ${selections} }`], { maxBuffer: 4_000_000 });
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
          : reviewDecision === "CHANGES_REQUESTED" ? "changes_requested"
          : reviewDecision === "REVIEW_REQUIRED" ? "review_required"
          : reviewRequests > 0 ? "review_requested" : "none";
        const commits = isRecord(pullRequest.commits) && Array.isArray(pullRequest.commits.nodes) ? pullRequest.commits.nodes : [];
        const commit = commits[commits.length - 1];
        const rollup = isRecord(commit) && isRecord(commit.commit) && isRecord(commit.commit.statusCheckRollup) ? commit.commit.statusCheckRollup : null;
        const state = String(rollup?.state ?? "");
        const checks: AuthoredPullRequestSignal["checks"] = state === "SUCCESS" ? "passing"
          : state === "FAILURE" || state === "ERROR" ? "failed"
          : state ? "pending" : "none";
        signals.set(`${repository}#${item.number}`, { checks, review });
      });
    } catch {
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
  };
}

export function projectSidebarTask(task: Task, projectName: string, linkedThreadIds: readonly string[]) {
  return {
    id: task.id, projectId: task.projectId, projectName, key: task.key, title: task.title,
    status: task.status, priority: task.priority, dueDate: task.dueDate, parentTaskId: task.parentTaskId,
    position: task.position,
    linkedThreadIds: [...linkedThreadIds],
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

export default async function plugin(bb: BbPluginApi) {
  async function tasksCall<T>(method: string, input: unknown, outputSchema: z.ZodType<T>): Promise<T> {
    return bb.sdk.plugins.callRpc({
      pluginId: TASKS_PLUGIN_ID, method, input: input as never, outputSchema,
    });
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
    const tasks = await listAllTasks({ activeOnly: true, sort: "priority" });
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
      result.push(projectSidebarTask(task, projectNames.get(task.projectId) ?? "Work", threads.map((thread) => thread.threadId)));
    }
    return result;
  }

  async function readBindings(): Promise<WorkBindings> { return normalizeBindings(await bb.storage.kv.get<unknown>(WORK_BINDINGS_KEY)); }
  async function writeBindings(bindings: WorkBindings) { await bb.storage.kv.set(WORK_BINDINGS_KEY, bindings); }
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
    if (!thread.environmentId) return { outcome: "absent" as const, message: "This thread has no workspace.", branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFiles: [] };
    try {
      const result = await bb.sdk.environments.status({ environmentId: thread.environmentId });
      if (result.outcome !== "available") return { outcome: result.outcome, message: "message" in result ? result.message : null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFiles: [] };
      const { workspace } = result;
      const mergeBase = workspace.mergeBase;
      return {
        outcome: "available" as const, message: null,
        branch: workspace.branch.currentBranch ?? (workspace.checkout.kind === "branch" ? workspace.checkout.branchName : null),
        base: mergeBase?.mergeBaseBranch ?? workspace.branch.defaultBranch,
        ahead: mergeBase?.aheadCount ?? 0, behind: mergeBase?.behindCount ?? 0,
        worktreeState: workspace.workingTree.state,
        hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
        changedFiles: workspace.workingTree.files.slice(0, 8).map((file) => ({ path: file.path, status: file.status, insertions: file.insertions, deletions: file.deletions })),
      };
    } catch (error) {
      return { outcome: "unavailable" as const, message: error instanceof Error ? error.message : "Repository status is unavailable.", branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFiles: [] };
    }
  }

  type AuthoredPullRequestEntry = { number: number; title: string; url: string; repository: string; state: "open" | "draft"; draft: boolean; head: string; base: string; checks: AuthoredPullRequestSignal["checks"]; review: AuthoredPullRequestSignal["review"]; stack: SidebarStack | null };
  let authoredPullRequestCache: { expiresAt: number; value: AuthoredPullRequestEntry[] } | null = null;
  let authoredPullRequestStacksCache: { expiresAt: number; value: AuthoredPullRequestEntry[] } | null = null;
  async function authoredPullRequests() {
    if (authoredPullRequestCache && authoredPullRequestCache.expiresAt > Date.now()) return authoredPullRequestCache.value;
    // `gh search prs` is GitHub's account-wide authored-PR search, unlike
    // `gh pr list`, which is restricted to one checkout's repository.
    // GitHub search exposes at most 1,000 matches. Request that full window so
    // this is genuinely the user's account-wide open-PR list, not a 100-row
    // subset that happens to include the current checkout.
    const { stdout } = await execFileAsync("gh", ["search", "prs", "--author", "@me", "--state", "open", "--limit", "1000", "--json", "number,title,url,repository,state,isDraft"], { maxBuffer: 12_000_000 });
    const search = parseAuthoredPullRequestSearch(JSON.parse(stdout));
    const archivedRepositories = await archivedGitHubRepositories(search.flatMap((item) => item.repository.nameWithOwner ? [item.repository.nameWithOwner] : []));
    const activeSearch = search.filter((item) => Boolean(item.repository.nameWithOwner) && !archivedRepositories.has(item.repository.nameWithOwner!));
    const signals = await authoredPullRequestSignals(activeSearch);
    const result: AuthoredPullRequestEntry[] = activeSearch.map((item) => {
      const repository = item.repository.nameWithOwner!;
      const signal = signals.get(`${repository}#${item.number}`) ?? UNKNOWN_AUTHORED_PULL_REQUEST_SIGNAL;
      return { number: item.number, title: item.title, url: item.url, repository, state: item.isDraft ? "draft" as const : "open" as const, draft: item.isDraft === true, head: "", base: "", checks: signal.checks, review: signal.review, stack: null };
    });
    // Render account-wide open PRs as soon as search, archive filtering, and
    // status signals arrive. Stack discovery is deliberately a second request.
    authoredPullRequestCache = { expiresAt: Date.now() + 5 * 60_000, value: result };
    return result;
  }
  async function authoredPullRequestStacks() {
    if (authoredPullRequestStacksCache && authoredPullRequestStacksCache.expiresAt > Date.now()) return authoredPullRequestStacksCache.value;
    const base = await authoredPullRequests();
    const byPullRequest = new Map(base.map((item) => [`${item.repository}#${item.number}`, item]));
    const describe = async (item: AuthoredPullRequestEntry): Promise<AuthoredPullRequestEntry> => {
      try {
        const { stdout } = await execFileAsync("gh", ["api", "--method", "GET", `repos/${item.repository}/stacks`, "-f", `pull_request=${item.number}`, "-H", `Accept: ${GITHUB_ACCEPT_HEADER}`, "-H", `X-GitHub-Api-Version: ${GITHUB_STACK_API_VERSION}`], { maxBuffer: 2_000_000 });
        const raw = parseGitHubStackResponse(JSON.parse(stdout));
        if (!raw) return item;
        const pullRequests = raw.pull_requests.flatMap((layer) => {
          const known = byPullRequest.get(`${item.repository}#${layer.number}`);
          return known ? [{ ...known, head: layer.head, base: layer.base || raw.base }] : [];
        });
        return pullRequests.length ? { ...item, stack: { id: `github-stack:${item.repository}:${raw.number}`, number: raw.number, base: raw.base, currentPullRequest: item.number, pullRequests } } : item;
      } catch { return item; }
    };
    const result: AuthoredPullRequestEntry[] = [];
    for (let start = 0; start < base.length; start += 12) result.push(...await Promise.all(base.slice(start, start + 12).map(describe)));
    bb.log.info(`resolved ${result.length} authored PRs; ${result.filter((pullRequest) => pullRequest.stack).length} Stack memberships`);
    authoredPullRequestStacksCache = { expiresAt: Date.now() + 5 * 60_000, value: result };
    return result;
  }

  bb.rpc.register(rpcContract, {
    async getSidebarOrder() {
      return { threadIds: sanitizeThreadOrder(await bb.storage.kv.get<unknown>(SIDEBAR_ORDER_KEY)) };
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
    async sidebarTasks() {
      try {
        if (!(await tasksAvailable())) return { available: false, tasks: [], error: null };
        return { available: true, tasks: await sidebarTasks(), error: null };
      } catch (error) {
        return { available: false, tasks: [], error: error instanceof Error ? error.message : String(error) };
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
    async sidebarAuthoredPullRequests({ force }) {
      try {
        if (force) { authoredPullRequestCache = null; authoredPullRequestStacksCache = null; }
        return { available: true, pullRequests: await authoredPullRequests(), error: null };
      } catch (error) {
        return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sidebarAuthoredPullRequestStacks() {
      try {
        return { available: true, pullRequests: await authoredPullRequestStacks(), error: null };
      } catch (error) {
        return { available: false, pullRequests: [], error: error instanceof Error ? error.message : String(error) };
      }
    },
    async setAuthoredPullRequestDraft({ url, draft }) {
      await execFileAsync("gh", ["pr", "ready", url, ...(draft ? ["--undo"] : [])], { maxBuffer: 1_000_000 });
      // The next PR-tab refresh should read GitHub's newly changed state,
      // rather than retain this process-local discovery cache.
      authoredPullRequestCache = null;
      authoredPullRequestStacksCache = null;
      return { draft };
    },
    async getWorkContext({ threadId }) {
      const thread = await bb.sdk.threads.get({ threadId });
      const available = await tasksAvailable();
      const links = available ? await taskLinks() : {};
      const timeline = await bb.sdk.threads.timeline({ threadId });
      const children = await listDescendantThreads(threadId);
      const root = await rootThread(threadId);
      const bindings = await readBindings();
      const outcomeBinding = bindings.outcomes.find((binding) => binding.rootThreadId === root.id) ?? null;
      const [tasksById, projects] = available ? await Promise.all([allTasksById(), tasksProjects()]) : [new Map<string, Task>(), [] as z.infer<typeof projectSchema>[]];
      const projectNames = new Map(projects.map((project) => [project.id, project.name]));
      const outcomeTask = outcomeBinding ? tasksById.get(outcomeBinding.outcomeTaskId) ?? null : null;
      const executionBindings = bindings.executions.filter((binding) => binding.rootThreadId === root.id);
      const executionTasks = executionBindings.flatMap((binding) => {
        const task = tasksById.get(binding.executionTaskId);
        return task ? [summarizeTask(task, projectNames.get(task.projectId) ?? "Work")] : [];
      });
      const legacy = available && !outcomeBinding ? await legacyContext(root.id, root.projectId) : { state: "none" as const, taskIds: [], message: null };
      const [stackResult, repository] = await Promise.all([githubStack(threadId), repositorySummary(thread)]);
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
        legacy,
        goal: timeline.goal ? {
          objective: timeline.goal.objective, status: timeline.goal.status,
          tokensUsed: timeline.goal.tokensUsed, tokenBudget: timeline.goal.tokenBudget,
          timeUsedSeconds: timeline.goal.timeUsedSeconds,
        } : null,
        todos: timeline.pendingTodos?.items ?? [],
        children: children.map(({ thread: child, depth }) => ({
          id: child.id, title: child.title ?? child.titleFallback ?? "Untitled agent", depth,
          status: child.status, runtimeStatus: child.runtime.displayStatus, providerId: child.providerId,
          task: links[child.id]?.[0] ? {
            key: links[child.id]![0].task.key,
            status: links[child.id]![0].task.status,
            liveStatus: links[child.id]![0].liveStatus,
          } : null,
        })),
        currentPullRequest: stackResult.currentPullRequest,
        stack: stackResult.stack,
        stackUnavailableReason: stackResult.reason,
        repository,
      };
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

  bb.agents.configure(() => ({
    tools: ["get_work_context", "create_work_task", "create_execution_task", "bind_execution_owner"], skills: [],
    instructions: "Before task creation, dispatch, or status change, call get_work_context at start/resume/after compaction. It reads durable bindings; no automatic compaction hook exists. Keep one top-level outcome per root work item, with execution tasks as direct children only. Bind direct work to the root or delegated work to one spawned child. Pending/recovery dispatch states require explicit reconciliation; never retry an uncertain spawn automatically. Task lifecycle is explicit: thread idle/completion never promotes a task.",
  }));

  bb.log.info("Work Sidebar backend loaded");
}

export { rpcContract } from "./contracts.js";
