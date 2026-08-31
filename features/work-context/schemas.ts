import { z } from "zod";

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
