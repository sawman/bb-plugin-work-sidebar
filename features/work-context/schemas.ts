import { z } from "zod";

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
  getWorkBackgroundJobs: {
    input: z.object({ threadId: z.string().startsWith("thr_") }).strict(),
    output: z.object({ items: z.array(backgroundJobSchema) }).strict(),
  },
} as const;
