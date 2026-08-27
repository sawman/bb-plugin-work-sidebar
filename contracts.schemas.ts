import { z } from "zod";
import { authoredPullRequest, pullRequest, pullRequestSignal, sidebarStack, sidebarStackLayer } from "./features/pull-requests/schemas.js";
import { sidebarTaskProjectSchema, sidebarTaskSchema, taskLinkSchema, taskPrioritySchema, taskStatusSchema, taskSummarySchema } from "./features/tasks/schemas.js";
import { threadArchiveSchemas, threadPreferenceSchemas } from "./features/threads/schemas.js";

const taskStatus = taskStatusSchema;
const taskPriority = taskPrioritySchema;
const taskSummary = taskSummarySchema;
const sidebarTask = sidebarTaskSchema;
const sidebarTaskProject = sidebarTaskProjectSchema;
const taskLink = taskLinkSchema;
const binding = z.object({
  rootThreadId: z.string(),
  outcomeTaskId: z.string(),
  taskProjectId: z.string(),
  executionTaskId: z.string().nullable(),
  ownerThreadId: z.string().nullable(),
  mode: z.enum(["direct", "delegated"]).nullable(),
  idempotencyKey: z.string().nullable(),
  dispatchState: z.enum(["ready", "pending_spawn", "pending_attachment", "recovery_required"]),
  recoveryMessage: z.string().nullable(),
});
const legacyContext = z.object({
  state: z.enum(["none", "adoptable", "ambiguous", "project_mismatch"]),
  taskIds: z.array(z.string()),
  message: z.string().nullable(),
});
const sidebarThreadPullRequest = z.object({
  number: z.number(), title: z.string(), url: z.string().url(),
  state: z.enum(["closed", "draft", "merged", "open"]),
  attention: z.enum(["blocked", "changes_requested", "checks_failed", "checks_pending", "closed", "conflicts", "draft", "merged", "none", "ready_to_merge", "review_requested"]),
});
const stackChange = z.object({ additions: z.number(), deletions: z.number(), files: z.array(z.object({ path: z.string(), previousPath: z.string().nullable(), status: z.enum(["added", "deleted", "modified", "renamed", "untracked"]), additions: z.number().nullable(), deletions: z.number().nullable() })), truncated: z.boolean() });
const githubStackBranch = z.object({
  name: z.string(), isCurrent: z.boolean(), isMerged: z.boolean(), isQueued: z.boolean(), needsRebase: z.boolean(), hasStash: z.boolean(), stashCount: z.number().int().nonnegative().nullable(),
  pr: z.object({ number: z.number(), url: z.string().url(), state: z.string(), title: z.string().nullable(), isDraft: z.boolean(), metadataStale: z.boolean() }).nullable(),
  diff: stackChange.nullable(), aheadOfRemote: z.number().nullable(), behindRemote: z.number().nullable(),
  checks: z.enum(["failed", "passing", "pending", "none", "unknown"]).optional(),
  review: z.enum(["approved", "changes_requested", "changes_requested_review_requested", "review_requested", "review_required", "none"]).optional(),
});
const githubStack = z.object({ trunk: z.string(), currentBranch: z.string().nullable(), branches: z.array(githubStackBranch), trunkBehind: z.number().nullable(), prunableBranchCount: z.number().int().nonnegative().nullable() });
const workChanges = z.object({
  currentPullRequest: pullRequest.nullable(),
  stack: z.object({ number: z.number(), base: z.string(), currentPullRequest: z.number(), pullRequests: z.array(sidebarStackLayer) }).nullable(),
  stackUnavailableReason: z.string().nullable(),
  githubStack: z.object({ stack: githubStack.nullable(), pending: stackChange.nullable(), error: z.string().nullable() }).nullable(),
  repository: z.object({ outcome: z.enum(["available", "not_applicable", "unavailable", "absent"]), message: z.string().nullable(), branch: z.string().nullable(), base: z.string().nullable(), ahead: z.number(), behind: z.number(), worktreeState: z.string().nullable(), hasUncommittedChanges: z.boolean(), changedFileCount: z.number().int().nonnegative(), changedInsertions: z.number().int().nonnegative(), changedDeletions: z.number().int().nonnegative(), changedFiles: z.array(z.object({ path: z.string(), status: z.string(), insertions: z.number().nullable(), deletions: z.number().nullable() })) }),
});
const threadPullRequestChanges = workChanges.pick({ currentPullRequest: true, stack: true, stackUnavailableReason: true, githubStack: true });
const workTracker = z.object({ visible: z.boolean(), available: z.boolean(), message: z.string().nullable(), suggestions: z.array(z.object({ key: z.string(), title: z.string(), url: z.string().url() })), item: z.object({ key: z.string(), title: z.string(), url: z.string().url(), status: z.string(), stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]), priority: z.string().nullable(), assignee: z.string().nullable(), project: z.string().nullable() }).nullable(), statusOptions: z.array(z.object({ id: z.string(), name: z.string(), current: z.boolean() })) });
const workProviderStatus = z.object({
  tone: z.enum(["green", "amber", "red"]),
  providerId: z.string(),
  providerName: z.string(),
  statusUrl: z.string().url().nullable(),
  status: z.enum(["ready", "not_installed", "unauthenticated", "expired", "unsupported_version", "unknown", "unavailable"]),
  message: z.string().nullable(),
});
const workCardInput = z.object({ threadId: z.string() }).strict();
const workStatus = z.object({
  currentThread: z.object({ title: z.string(), status: z.enum(["active", "error", "idle", "starting", "stopping"]), runtimeStatus: z.string(), providerId: z.string() }),
  children: z.array(z.object({ id: z.string(), title: z.string(), depth: z.number().int().nonnegative(), status: z.string(), runtimeStatus: z.string(), providerId: z.string(), isArchived: z.boolean(), task: z.object({ key: z.string(), status: taskStatus, liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]) }).nullable() })),
  activity: z.object({ latest: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable(), lastUser: z.object({ text: z.string(), kind: z.literal("user") }).nullable(), current: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable() }),
});
const workOutcome = z.object({ tasksAvailable: z.boolean(), outcome: taskSummary.nullable(), executionTasks: z.array(taskSummary), bindings: z.array(binding) });
const workGoal = z.object({ objective: z.string(), status: z.enum(["active", "budgetLimited", "complete", "paused"]), tokensUsed: z.number(), tokenBudget: z.number().nullable(), timeUsedSeconds: z.number() }).nullable();
const workPlan = z.object({ items: z.array(z.object({ id: z.string(), text: z.string(), status: z.enum(["completed", "in_progress", "pending"]) })) });

export type GitHubStackBranch = z.infer<typeof githubStackBranch>;
export type GitHubStackSignal = z.infer<typeof sidebarStackLayer>;

export const rpcSchemas = {
  ...threadPreferenceSchemas,
  sidebarTasks: {
    input: z.null(),
    output: z.object({
      available: z.boolean(),
      tasks: z.array(sidebarTask),
      projects: z.array(sidebarTaskProject),
      error: z.string().nullable(),
    }),
  },
  sidebarTaskLinks: {
    input: z.null(),
    output: z.object({
      available: z.boolean(),
      links: z.record(z.string(), z.array(taskLink)),
      error: z.string().nullable(),
    }),
  },
  sidebarPullRequestStacks: {
    input: z.object({ threadIds: z.array(z.string().startsWith("thr_")).max(200) }).strict(),
    output: z.object({
      available: z.boolean(), stacks: z.record(z.string(), sidebarStack),
      mergeTargets: z.record(z.string(), z.string()), error: z.string().nullable(),
    }).strict(),
  },
  sidebarThreadPullRequests: {
    input: z.object({ threadIds: z.array(z.string().startsWith("thr_")).max(200) }).strict(),
    output: z.object({ available: z.boolean(), pullRequests: z.record(z.string(), sidebarThreadPullRequest.nullable()), error: z.string().nullable() }).strict(),
  },
  sidebarAuthoredPullRequests: {
    input: z.object({ force: z.boolean().optional() }).strict(),
    output: z.object({
      available: z.boolean(),
      pullRequests: z.array(authoredPullRequest),
      error: z.string().nullable(),
    }).strict(),
  },
  sidebarAuthoredPullRequestStacks: {
    input: z.null(),
    output: z.object({
      available: z.boolean(),
      pullRequests: z.array(authoredPullRequest),
      error: z.string().nullable(),
    }).strict(),
  },
  setAuthoredPullRequestDraft: {
    input: z.object({ url: z.string().url(), draft: z.boolean() }).strict(),
    output: z.object({ draft: z.boolean() }).strict(),
  },
  ...threadArchiveSchemas,
  getWorkContext: {
    input: z.object({ threadId: z.string() }).strict(),
    output: z.object({
      tasksAvailable: z.boolean(),
      currentThread: z.object({
        title: z.string(),
        status: z.enum(["active", "error", "idle", "starting", "stopping"]),
        runtimeStatus: z.string(),
        providerId: z.string(),
      }),
      tasks: z.array(taskSummary),
      subtasks: z.array(taskSummary),
      outcome: taskSummary.nullable(),
      executionTasks: z.array(taskSummary),
      bindings: z.array(binding),
      legacy: legacyContext,
      goal: z.object({
        objective: z.string(),
        status: z.enum(["active", "budgetLimited", "complete", "paused"]),
        tokensUsed: z.number(),
        tokenBudget: z.number().nullable(),
        timeUsedSeconds: z.number(),
      }).nullable(),
      todos: z.array(z.object({
        id: z.string(),
        text: z.string(),
        status: z.enum(["completed", "in_progress", "pending"]),
      })),
      activity: z.object({
        latest: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable(),
        lastUser: z.object({ text: z.string(), kind: z.literal("user") }).nullable(),
        current: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable(),
      }),
      children: z.array(z.object({
        id: z.string(),
        title: z.string(),
        depth: z.number().int().nonnegative(),
        status: z.string(),
        runtimeStatus: z.string(),
        providerId: z.string(),
        isArchived: z.boolean(),
        task: z.object({
          key: z.string(),
          status: taskStatus,
          liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
        }).nullable(),
      })),
      currentPullRequest: pullRequest.nullable(),
      stack: z.object({ number: z.number(), base: z.string(), currentPullRequest: z.number(), pullRequests: z.array(sidebarStackLayer) }).nullable(),
      stackUnavailableReason: z.string().nullable(),
      githubStack: z.object({ stack: githubStack.nullable(), pending: stackChange.nullable(), error: z.string().nullable() }).nullable(),
      repository: z.object({
        outcome: z.enum(["available", "not_applicable", "unavailable", "absent"]),
        message: z.string().nullable(),
        branch: z.string().nullable(),
        base: z.string().nullable(),
        ahead: z.number(),
        behind: z.number(),
        worktreeState: z.string().nullable(),
        hasUncommittedChanges: z.boolean(),
        changedFileCount: z.number().int().nonnegative(),
        changedInsertions: z.number().int().nonnegative(),
        changedDeletions: z.number().int().nonnegative(),
        changedFiles: z.array(z.object({ path: z.string(), status: z.string(), insertions: z.number().nullable(), deletions: z.number().nullable() })),
      }),
      tracker: z.object({
        visible: z.boolean(),
        available: z.boolean(),
        message: z.string().nullable(),
        suggestions: z.array(z.object({ key: z.string(), title: z.string(), url: z.string().url() })),
        item: z.object({
          key: z.string(), title: z.string(), url: z.string().url(), status: z.string(),
          stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]),
          priority: z.string().nullable(), assignee: z.string().nullable(), project: z.string().nullable(),
        }).nullable(),
        statusOptions: z.array(z.object({ id: z.string(), name: z.string(), current: z.boolean() })),
      }),
    }),
  },
  getWorkStatus: { input: workCardInput, output: workStatus },
  getWorkOutcome: { input: workCardInput, output: workOutcome },
  getWorkGoal: { input: workCardInput, output: workGoal },
  getWorkPlan: { input: workCardInput, output: workPlan },
  getWorkChanges: { input: z.object({ threadId: z.string(), force: z.boolean().optional(), pullRequests: z.boolean().optional() }).strict(), output: workChanges },
  getThreadPullRequestChanges: { input: z.object({ threadId: z.string().startsWith("thr_") }).strict(), output: threadPullRequestChanges },
  getPullRequestFingerprint: { input: z.object({ url: z.string().url() }).strict(), output: z.object({ fingerprint: z.string().nullable() }) },
  getGitHubPollingPolicy: { input: z.null(), output: z.object({ activePollMs: z.number().int().positive(), backgroundPollMs: z.number().int().positive(), maxRestPollsPerMinute: z.number().int().positive() }) },
  getWorkTracker: { input: z.object({ threadId: z.string() }).strict(), output: workTracker },
  getWorkProviderStatus: { input: z.object({ threadId: z.string() }).strict(), output: workProviderStatus },
  getGitHubApiHealth: { input: z.null(), output: z.object({ state: z.enum(["available", "rate_limited", "unavailable"]), scope: z.enum(["graphql", "rest", "unknown"]), message: z.string().nullable(), retryAt: z.number().nullable() }) },
  checkoutStackBranch: {
    input: z.object({ threadId: z.string().startsWith("thr_"), branch: z.string().min(1).max(255) }).strict(),
    output: z.object({ ok: z.boolean(), message: z.string(), tone: z.enum(["success", "warning", "error"]).optional(), detail: z.string().nullable() }),
  },
  linkLinearIssue: {
    input: z.object({ threadId: z.string().startsWith("thr_"), key: z.string().trim().min(2).max(64) }).strict(),
    output: z.object({ key: z.string(), title: z.string() }),
  },
  searchLinearIssues: {
    input: z.object({ threadId: z.string().startsWith("thr_"), query: z.string().trim().max(160) }).strict(),
    output: z.object({ items: z.array(z.object({ key: z.string(), title: z.string(), url: z.string().url() })) }),
  },
  getLatestActivity: {
    input: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({
      currentThread: z.object({
        status: z.enum(["active", "error", "idle", "starting", "stopping"]),
        runtimeStatus: z.string(),
      }),
      latest: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable(),
      lastUser: z.object({ text: z.string(), kind: z.literal("user") }).nullable(),
      current: z.object({ text: z.string(), kind: z.enum(["assistant", "user", "command", "activity"]) }).nullable(),
    }),
  },
  getWorkingTreeFileDiff: {
    input: z.object({ threadId: z.string().startsWith("thr_"), path: z.string().min(1) }).strict(),
    output: z.object({ available: z.boolean(), patch: z.string().nullable(), message: z.string().nullable() }).strict(),
  },
  unlinkLinearIssue: {
    input: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  updateLinearIssueStatus: {
    input: z.object({ threadId: z.string().startsWith("thr_"), statusId: z.string().min(1) }).strict(),
    output: z.object({ key: z.string(), status: z.string() }),
  },
  createWorkTask: {
    input: z.object({
      threadId: z.string(),
      title: z.string().trim().min(1),
      description: z.string().default(""),
      parentTaskId: z.string().nullable().default(null),
      taskProjectId: z.string().nullable().optional(),
    }).strict(),
    output: z.object({ task: taskSummary }),
  },
  ensureOutcomeContext: {
    input: z.object({
      rootThreadId: z.string(), title: z.string().trim().min(1), description: z.string().default(""),
      taskProjectId: z.string().nullable().optional(),
    }).strict(),
    output: z.object({ task: taskSummary, binding: binding }),
  },
  createExecutionTask: {
    input: z.object({
      rootThreadId: z.string(), title: z.string().trim().min(1), description: z.string().default(""),
      idempotencyKey: z.string().trim().min(1).max(200),
    }).strict(),
    output: z.object({ task: taskSummary, binding: binding, reused: z.boolean() }),
  },
  bindExecutionOwner: {
    input: z.object({
      rootThreadId: z.string(), idempotencyKey: z.string().trim().min(1).max(200),
      mode: z.enum(["direct", "delegated"]), prompt: z.string().trim().min(1).optional(),
      title: z.string().trim().min(1).optional(), visibility: z.enum(["visible", "hidden"]).optional(),
    }).strict(),
    output: z.object({ binding: binding, spawnedThreadId: z.string().nullable() }),
  },
  adoptLegacyOutcome: {
    input: z.object({ rootThreadId: z.string(), taskId: z.string() }).strict(),
    output: z.object({ task: taskSummary, binding: binding }),
  },
  updateWorkTask: {
    input: z.object({ taskId: z.string(), status: taskStatus }).strict(),
    output: z.object({ task: taskSummary }),
  },
  updateTaskStatus: {
    input: z.object({ taskId: z.string(), status: taskStatus }).strict(),
    output: z.object({ task: taskSummary }),
  },
  updateTaskAssignee: {
    input: z.object({ taskId: z.string(), assignee: z.enum(["agent", "human"]) }).strict(),
    output: z.object({ taskId: z.string(), assignee: z.enum(["agent", "human"]) }),
  },
  createSidebarTask: {
    input: z.object({ projectId: z.string(), title: z.string().trim().min(1).max(240), assignee: z.enum(["agent", "human"]) }).strict(),
    output: z.object({ task: sidebarTask }),
  },
  deleteSidebarTask: {
    input: z.object({ taskId: z.string() }).strict(),
    output: z.object({ deleted: z.boolean() }).strict(),
  },
  attachTaskToThread: {
    input: z.object({ taskId: z.string(), threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
  },
  detachTaskFromThread: {
    input: z.object({ taskId: z.string(), threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
  },
  reorderTask: {
    input: z.object({ taskId: z.string(), beforeTaskId: z.string().nullable(), afterTaskId: z.string().nullable() }).strict(),
    output: z.object({ task: taskSummary }),
  },
};
