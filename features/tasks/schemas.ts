import { z } from "zod";

export const taskStatusSchema = z.enum([
  "backlog",
  "todo",
  "in_progress",
  "in_review",
  "done",
  "canceled",
]);
export const taskPrioritySchema = z.enum([
  "urgent",
  "high",
  "medium",
  "low",
  "none",
]);
export const taskSummarySchema = z.object({
  id: z.string(),
  projectId: z.string(),
  projectName: z.string(),
  key: z.string(),
  title: z.string(),
  status: taskStatusSchema,
  priority: taskPrioritySchema,
  dueDate: z.string().nullable(),
  parentTaskId: z.string().nullable(),
});
export const sidebarTaskSchema = taskSummarySchema.extend({
  position: z.number().optional(),
  linkedThreadIds: z.array(z.string()),
  assignee: z.enum(["agent", "human"]),
});
export const sidebarTaskProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
});
export const taskLinkSchema = z.object({
  task: taskSummarySchema,
  threadId: z.string(),
  threadTitle: z.string().nullable().optional(),
  liveStatus: z.enum(["starting", "working", "idle", "completed", "failed"]),
  role: z.enum(["outcome", "execution"]),
  mode: z.enum(["direct", "delegated"]).nullable(),
  idempotencyKey: z.string().nullable(),
  dispatchState: z
    .enum(["ready", "pending_spawn", "pending_attachment", "recovery_required"])
    .nullable(),
});
