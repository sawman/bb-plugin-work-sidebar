import { z } from "zod";

/** Strict Taskboard wire payloads never cross the plugin RPC boundary. */
export const taskboardItemSchema = z
  .object({
    bbProjectId: z.string(),
    source: z.literal("linear"),
    locator: z.string(),
    key: z.string(),
    title: z.string(),
    description: z.string(),
    url: z.string().url(),
    status: z.string(),
    stateCategory: z.enum([
      "backlog",
      "todo",
      "in_progress",
      "done",
      "canceled",
    ]),
    priority: z.string().nullable(),
    assignee: z.string().nullable(),
    project: z.string().nullable(),
    labels: z.array(z.string()),
    updatedAt: z.string(),
  })
  .strict();
export const taskboardDetailSchema = taskboardItemSchema
  .extend({
    comments: z.array(
      z
        .object({ author: z.string(), body: z.string(), createdAt: z.string() })
        .strict(),
    ),
  })
  .strict();
export const taskboardStatusOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    stateCategory: z.enum([
      "backlog",
      "todo",
      "in_progress",
      "done",
      "canceled",
    ]),
    current: z.boolean(),
  })
  .strict();
export const trackerItemSchema = z.object({
  key: z.string(),
  title: z.string(),
  url: z.string().url(),
  status: z.string(),
  stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]),
  priority: z.string().nullable(),
  assignee: z.string().nullable(),
  project: z.string().nullable(),
});
export const trackerStatusOptionSchema = z.object({
  id: z.string(),
  name: z.string(),
  current: z.boolean(),
});
export const trackerLinkedItemSchema = z.object({
  item: trackerItemSchema,
  statusOptions: z.array(trackerStatusOptionSchema),
});
export const trackerContextSchema = z.object({
  visible: z.boolean(),
  available: z.boolean(),
  message: z.string().nullable(),
  suggestions: z.array(
    z.object({ key: z.string(), title: z.string(), url: z.string().url() }),
  ),
  items: z.array(trackerLinkedItemSchema),
});

const threadInput = z
  .object({ threadId: z.string().startsWith("thr_") })
  .strict();
export const trackerRpcSchemas = {
  getWorkTracker: { input: threadInput, output: trackerContextSchema },
  linkLinearIssue: {
    input: threadInput
      .extend({ key: z.string().trim().min(2).max(64) })
      .strict(),
    output: z.object({ key: z.string(), title: z.string() }),
  },
  searchLinearIssues: {
    input: threadInput.extend({ query: z.string().trim().max(160) }).strict(),
    output: z.object({
      items: z.array(
        z.object({ key: z.string(), title: z.string(), url: z.string().url() }),
      ),
    }),
  },
  unlinkLinearIssue: {
    input: threadInput.extend({ key: z.string().trim().min(2).max(64) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  updateLinearIssueStatus: {
    input: threadInput
      .extend({
        key: z.string().trim().min(2).max(64),
        statusId: z.string().min(1),
      })
      .strict(),
    output: z.object({ key: z.string(), status: z.string() }),
  },
};

export type TrackerContext = z.infer<typeof trackerContextSchema>;
