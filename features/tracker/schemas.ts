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
export const trackerItemSchema = z
  .object({
    key: z.string(),
    title: z.string(),
    url: z.string().url(),
    status: z.string(),
    stateCategory: z.enum(["backlog", "todo", "in_progress", "done", "canceled"]),
    priority: z.string().nullable(),
    assignee: z.string().nullable(),
    project: z.string().nullable(),
  })
  .strict();
export const trackerStatusOptionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    current: z.boolean(),
  })
  .strict();
export const trackerLinkedItemSchema = z
  .object({
    item: trackerItemSchema,
    statusOptions: z.array(trackerStatusOptionSchema),
  })
  .strict();
const trackerSuggestionSchema = z
  .object({ key: z.string(), title: z.string(), url: z.string().url() })
  .strict();
export const trackerContextSchema = z
  .object({
    visible: z.boolean(),
    available: z.boolean(),
    message: z.string().nullable(),
    primaryKey: z.string().nullable(),
    suggestions: z.array(trackerSuggestionSchema),
    items: z.array(trackerLinkedItemSchema),
  })
  .strict();

const threadInput = z
  .object({ threadId: z.string().startsWith("thr_") })
  .strict();
export const trackerRpcSchemas = {
  getWorkTracker: { input: threadInput, output: trackerContextSchema },
  linkLinearIssue: {
    input: threadInput
      .extend({ key: z.string().trim().min(2).max(64) })
      .strict(),
    output: z.object({ key: z.string(), title: z.string() }).strict(),
  },
  searchLinearIssues: {
    input: threadInput.extend({ query: z.string().trim().max(160) }).strict(),
    output: z.object({ items: z.array(trackerSuggestionSchema) }).strict(),
  },
  unlinkLinearIssue: {
    input: threadInput.extend({ key: z.string().trim().min(2).max(64) }).strict(),
    output: z.object({ ok: z.literal(true) }).strict(),
  },
  setPrimaryLinearIssue: {
    input: threadInput.extend({ key: z.string().trim().min(2).max(64) }).strict(),
    output: z.object({ key: z.string() }).strict(),
  },
  updateLinearIssueStatus: {
    input: threadInput
      .extend({
        key: z.string().trim().min(2).max(64),
        statusId: z.string().min(1),
      })
      .strict(),
    output: z.object({ key: z.string(), status: z.string() }).strict(),
  },
};

export type TrackerContext = z.infer<typeof trackerContextSchema>;
