import { z } from "zod";
import {
  executionTaskSummarySchema,
  taskStatusSchema,
  taskSummarySchema,
} from "../tasks/schemas.js";

const workItemReferenceSchema = z
  .object({ source: z.enum(["bb_task", "linear"]), id: z.string().trim().min(1).max(160) })
  .strict();
const workItemQueueSchema = z
  .object({
    current: workItemReferenceSchema.nullable(),
    backlog: z.array(workItemReferenceSchema).max(100),
  })
  .strict();
const persistedWorkItemQueueSchema = z
  .object({ configured: z.boolean(), queue: workItemQueueSchema })
  .strict();
const workItemQueueInput = z.object({ threadId: z.string().startsWith("thr_") }).strict();

export const backgroundJobStatusSchema = z.enum([
  "completed",
  "failed",
  "killed",
  "paused",
  "pending",
  "running",
  "stopped",
]);
export type BackgroundJobStatus = z.infer<typeof backgroundJobStatusSchema>;

const backgroundJobSchema = z
  .object({
    id: z.string(),
    kind: z.enum(["command", "workflow"]),
    title: z.string(),
    detail: z.string().nullable(),
    taskType: z.string(),
    status: backgroundJobStatusSchema,
    startedAt: z.number(),
    completedAt: z.number().nullable(),
    model: z.string().nullable(),
  })
  .strict();

export const workBindingOwnerSchema = z
  .object({
    threadId: z.string(),
    title: z.string(),
    providerId: z.string(),
    liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
    isArchived: z.boolean(),
  })
  .strict();
export const workBindingSchema = z.object({
  rootThreadId: z.string(),
  outcomeTaskId: z.string(),
  taskProjectId: z.string(),
  executionTaskId: z.string().nullable(),
  ownerThreadId: z.string().nullable(),
  mode: z.enum(["direct", "delegated"]).nullable(),
  idempotencyKey: z.string().nullable(),
  dispatchState: z.enum(["ready", "pending_spawn", "pending_attachment", "recovery_required"]),
  recoveryMessage: z.string().nullable(),
  owner: workBindingOwnerSchema.nullable().optional(),
});
export const legacyWorkContextSchema = z.object({
  state: z.enum(["none", "adoptable", "ambiguous", "project_mismatch"]),
  taskIds: z.array(z.string()),
  message: z.string().nullable(),
});
export const workCardInputSchema = z.object({ threadId: z.string() }).strict();
export const workStatusSchema = z.object({
  rootThreadId: z.string(),
  currentThread: z.object({
    title: z.string(),
    status: z.enum(["active", "error", "idle", "pending", "starting", "stopping"]),
    runtimeStatus: z.string(),
    providerId: z.string(),
    environmentId: z.string().nullable().optional(),
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
      status: taskStatusSchema,
      liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
    }).nullable(),
  })),
});
export const workProviderStatusSchema = z.object({
  tone: z.enum(["green", "amber", "red"]),
  providerId: z.string(),
  providerName: z.string(),
  statusUrl: z.string().url().nullable(),
  status: z.enum([
    "ready",
    "not_installed",
    "unauthenticated",
    "expired",
    "unsupported_version",
    "unknown",
    "unavailable",
  ]),
  message: z.string().nullable(),
  usage: z.object({
    status: z.enum(["ok", "unavailable"]),
    planLabel: z.string().nullable(),
    message: z.string().nullable(),
    windows: z.array(z.object({
      label: z.string(),
      usedPercent: z.number(),
      resetsAt: z.string().nullable(),
    })),
  }).nullable().default(null),
});
export type WorkProviderStatus = z.infer<typeof workProviderStatusSchema>;
export const workOutcomeSchema = z.object({
  rootThreadId: z.string(),
  tasksAvailable: z.boolean(),
  outcome: taskSummarySchema.nullable(),
  executionTasks: z.array(executionTaskSummarySchema),
  bindings: z.array(workBindingSchema),
  legacy: legacyWorkContextSchema,
});
export const workGoalSchema = z.object({
  objective: z.string(),
  status: z.enum(["active", "budgetLimited", "complete", "paused"]),
  tokensUsed: z.number(),
  tokenBudget: z.number().nullable(),
  timeUsedSeconds: z.number(),
}).nullable();
export const workPlanSchema = z.object({
  items: z.array(z.object({
    id: z.string(),
    text: z.string(),
    status: z.enum(["completed", "in_progress", "pending"]),
  })),
});
export const workContextSchema = z.object({
  rootThreadId: z.string(),
  tasksAvailable: z.boolean(),
  currentThread: z.object({
    title: z.string(),
    status: z.enum(["active", "error", "idle", "pending", "starting", "stopping"]),
    runtimeStatus: z.string(),
    providerId: z.string(),
  }),
  tasks: z.array(taskSummarySchema),
  subtasks: z.array(taskSummarySchema),
  outcome: taskSummarySchema.nullable(),
  executionTasks: z.array(executionTaskSummarySchema),
  bindings: z.array(workBindingSchema),
  legacy: legacyWorkContextSchema,
  goal: workGoalSchema,
  todos: workPlanSchema.shape.items,
  children: workStatusSchema.shape.children,
});

export const workContextRpcSchemas = {
  getWorkItemQueue: {
    input: workItemQueueInput,
    output: z.object({ rootThreadId: z.string().startsWith("thr_"), ...persistedWorkItemQueueSchema.shape }).strict(),
  },
  saveWorkItemQueue: {
    input: workItemQueueInput.extend({ queue: workItemQueueSchema }).strict(),
    output: z.object({ rootThreadId: z.string().startsWith("thr_"), ...persistedWorkItemQueueSchema.shape }).strict(),
  },
  moveWorkItemToExecution: {
    input: workItemQueueInput
      .extend({
        reference: workItemReferenceSchema,
        title: z.string().trim().min(1).max(240),
        description: z.string().max(4_000).default(""),
      })
      .strict(),
    output: z
      .object({
        taskId: z.string(),
        ...persistedWorkItemQueueSchema.shape,
      })
      .strict(),
  },
  getWorkBackgroundJobs: {
    input: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ items: z.array(backgroundJobSchema) }).strict(),
  },
} as const;
