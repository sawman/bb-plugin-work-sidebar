import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

const taskStatus = z.enum(["backlog", "todo", "in_progress", "in_review", "done", "canceled"]);
const taskPriority = z.enum(["urgent", "high", "medium", "low", "none"]);
const taskSummary = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  key: z.string(),
  title: z.string(),
  status: taskStatus,
  priority: taskPriority,
  dueDate: z.string().nullable(),
  parentTaskId: z.string().nullable(),
});
const sidebarTask = taskSummary.extend({
  linkedThreadIds: z.array(z.string()),
});
const taskLink = z.object({
  task: taskSummary,
  threadId: z.string(),
  liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
  role: z.enum(["outcome", "execution"]),
  mode: z.enum(["direct", "delegated"]).nullable(),
  idempotencyKey: z.string().nullable(),
  dispatchState: z.enum(["ready", "pending_spawn", "pending_attachment", "recovery_required"]).nullable(),
});
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
const pullRequest = z.object({
  number: z.number(),
  title: z.string(),
  url: z.string(),
  state: z.enum(["closed", "draft", "merged", "open"]),
  head: z.string(),
  base: z.string(),
  checks: z.object({
    failedCount: z.number(),
    passedCount: z.number(),
    pendingCount: z.number(),
    state: z.enum(["failing", "no_checks", "passing", "pending", "unknown"]),
    totalCount: z.number(),
  }),
  review: z.object({
    reviewRequestCount: z.number(),
    state: z.enum(["approved", "changes_requested", "none", "review_requested", "review_required"]),
  }),
  attention: z.enum(["blocked", "changes_requested", "checks_failed", "checks_pending", "closed", "conflicts", "draft", "merged", "none", "ready_to_merge", "review_requested"]),
  mergeability: z.object({
    mergeStateStatus: z.enum(["BEHIND", "BLOCKED", "CLEAN", "DRAFT", "HAS_HOOKS", "DIRTY", "UNKNOWN", "UNSTABLE"]).nullable(),
    mergeable: z.enum(["CONFLICTING", "MERGEABLE", "UNKNOWN"]).nullable(),
    state: z.enum(["blocked", "conflicts", "draft", "mergeable", "unknown"]),
  }),
});

export const rpcContract = defineRpcContract({
  getSidebarOrder: {
    input: z.null(),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
  saveSiblingOrder: {
    input: z.object({ threadIds: z.array(z.string()) }).strict(),
    output: z.object({ threadIds: z.array(z.string()) }).strict(),
  },
  sidebarTasks: {
    input: z.null(),
    output: z.object({
      available: z.boolean(),
      tasks: z.array(sidebarTask),
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
      children: z.array(z.object({
        id: z.string(),
        title: z.string(),
        depth: z.number().int().nonnegative(),
        status: z.string(),
        runtimeStatus: z.string(),
        providerId: z.string(),
        task: z.object({
          key: z.string(),
          status: taskStatus,
          liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
        }).nullable(),
      })),
      currentPullRequest: pullRequest.nullable(),
      stack: z.object({
        number: z.number(),
        base: z.string(),
        currentPullRequest: z.number(),
        pullRequests: z.array(z.object({
          number: z.number(),
          title: z.string(),
          state: z.string(),
          draft: z.boolean(),
          url: z.string(),
          head: z.string(),
          base: z.string(),
        })),
      }).nullable(),
      stackUnavailableReason: z.string().nullable(),
    }),
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
    input: z.object({ taskId: z.string(), status: z.literal("in_review") }).strict(),
    output: z.object({ task: taskSummary }),
  },
});
