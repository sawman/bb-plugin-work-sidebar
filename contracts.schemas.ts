import { z } from "zod";
import { agentRpcSchemas } from "./features/agents/schemas.js";
import { authoredPullRequest, githubApiHealth, pullRequestReviewerRpcSchemas, sidebarStack, sidebarStackLayer } from "./features/pull-requests/schemas.js";
import { executionTaskSummarySchema, sidebarTaskProjectSchema, sidebarTaskSchema, taskLinkSchema, taskPrioritySchema, taskStatusSchema, taskSummarySchema } from "./features/tasks/schemas.js";
import { threadArchiveSchemas, threadHierarchySchemas, threadPreferenceSchemas } from "./features/threads/schemas.js";
import { trackerRpcSchemas } from "./features/tracker/schemas.js";
import { changesRpcSchemas, githubStackBranchSchema } from "./features/changes/schemas.js";
import {
  workBindingSchema,
  workCardInputSchema,
  workContextSchema,
  workContextRpcSchemas,
  workGoalSchema,
  workOutcomeSchema,
  workPlanSchema,
  workStatusSchema,
} from "./features/work-context/schemas.js";
const taskStatus = taskStatusSchema; const taskPriority = taskPrioritySchema;
const taskSummary = taskSummarySchema; const sidebarTask = sidebarTaskSchema;
const executionTaskSummary = executionTaskSummarySchema;
const sidebarTaskProject = sidebarTaskProjectSchema; const taskLink = taskLinkSchema;
const sidebarThreadPullRequest = z.object({
  number: z.number(), title: z.string(), url: z.string().url(),
  state: z.enum(["closed", "draft", "merged", "open"]),
  attention: z.enum(["blocked", "changes_requested", "checks_failed", "checks_pending", "closed", "conflicts", "draft", "merged", "none", "ready_to_merge", "review_requested"]),
});
const workProviderStatus = z.object({
  tone: z.enum(["green", "amber", "red"]),
  providerId: z.string(),
  providerName: z.string(),
  statusUrl: z.string().url().nullable(),
  status: z.enum(["ready", "not_installed", "unauthenticated", "expired", "unsupported_version", "unknown", "unavailable"]),
  message: z.string().nullable(),
});
export type GitHubStackBranch = z.infer<typeof githubStackBranchSchema>;
export type GitHubStackSignal = z.infer<typeof sidebarStackLayer>;
export const rpcSchemas = {
  ...agentRpcSchemas,
  ...changesRpcSchemas,
  ...threadPreferenceSchemas, ...threadHierarchySchemas,
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
  ...pullRequestReviewerRpcSchemas, ...threadArchiveSchemas,
  getWorkContext: {
    input: z.object({ threadId: z.string() }).strict(),
    output: workContextSchema,
  },
  getWorkStatus: { input: workCardInputSchema, output: workStatusSchema },
  getWorkOutcome: { input: workCardInputSchema, output: workOutcomeSchema },
  getWorkGoal: { input: workCardInputSchema, output: workGoalSchema },
  getWorkPlan: { input: workCardInputSchema, output: workPlanSchema },
  ...workContextRpcSchemas,
  getGitHubPollingPolicy: { input: z.null(), output: z.object({ activePollMs: z.number().int().positive(), backgroundPollMs: z.number().int().positive(), maxRestPollsPerMinute: z.number().int().positive() }) },
  ...trackerRpcSchemas,
  getWorkProviderStatus: { input: z.object({ threadId: z.string() }).strict(), output: workProviderStatus },
  getGitHubApiHealth: { input: z.null(), output: githubApiHealth },
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
  createWorkTask: {
    input: z.object({
      threadId: z.string(),
      title: z.string().trim().min(1),
      description: z.string().default(""),
      parentTaskId: z.string().nullable().default(null),
      taskProjectId: z.string().nullable().optional(), priority: taskPriority.optional(),
    }).strict(),
    output: z.object({ task: taskSummary }),
  },
  ensureOutcomeContext: {
    input: z.object({
      rootThreadId: z.string(), title: z.string().trim().min(1), description: z.string().default(""),
      taskProjectId: z.string().nullable().optional(), priority: taskPriority.optional(),
    }).strict(),
    output: z.object({ task: taskSummary, binding: workBindingSchema }),
  },
  createExecutionTask: {
    input: z
      .object({
        rootThreadId: z.string(),
        title: z.string().trim().min(1),
        description: z.string().default(""),
        idempotencyKey: z.string().trim().min(1).max(200),
        assignee: z.enum(["agent", "human"]),
      })
      .strict(),
    output: z.object({
      task: executionTaskSummary,
      binding: workBindingSchema,
      reused: z.boolean(),
    }),
  },
  bindExecutionOwner: {
    input: z
      .object({
        rootThreadId: z.string(), idempotencyKey: z.string().trim().min(1).max(200),
        mode: z.enum(["direct", "delegated"]), prompt: z.string().trim().min(1).optional(),
        title: z.string().trim().min(1).optional(), visibility: z.enum(["visible", "hidden"]).optional(), environment: z.enum(["managed-worktree", "reuse"]).optional(),
        baseBranch: z.string().trim().min(1).optional(),
      })
      .strict()
      .superRefine((input, context) => {
        if (input.baseBranch && input.environment !== "managed-worktree")
          context.addIssue({ code: "custom", path: ["baseBranch"], message: "baseBranch requires environment managed-worktree" });
        if (input.mode === "direct" && (input.environment || input.baseBranch))
          context.addIssue({ code: "custom", path: ["environment"], message: "Environment selection is only valid for delegated execution" });
      }),
    output: z.object({ binding: workBindingSchema, spawnedThreadId: z.string().nullable() }),
  },
  adoptLegacyOutcome: {
    input: z.object({ rootThreadId: z.string(), taskId: z.string() }).strict(),
    output: z.object({ task: taskSummary, binding: workBindingSchema }),
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
