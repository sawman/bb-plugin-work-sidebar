import { z } from "zod";

export const humanMessageIdSchema = z.string().regex(/^msg_[A-Za-z0-9_-]+$/);
const threadId = z.string().startsWith("thr_");
const timestamp = z.string().datetime();

export const humanMessageSchema = z.object({
  id: humanMessageIdSchema,
  threadId,
  projectId: z.string().min(1),
  subject: z.string().max(160).nullable(),
  body: z.string().min(1).max(32 * 1024),
  agentThreadId: threadId.nullable(),
  providerId: z.string().min(1).nullable(),
  agentLabel: z.string().min(1).max(160).nullable(),
  createdAt: timestamp,
  updatedAt: timestamp,
  acknowledgedAt: timestamp.nullable(),
  bookmarkedAt: timestamp.nullable(),
  revision: z.number().int().positive(),
}).strict();

const listInput = z.object({
  threadId,
  query: z.string().trim().max(1_000).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
}).strict();

export const inboxRpcSchemas = {
  listHumanMessages: {
    input: listInput,
    output: z.object({
      messages: z.array(humanMessageSchema),
      cursor: z.string().nullable(),
      activeCount: z.number().int().nonnegative(),
      savedCount: z.number().int().nonnegative(),
      historyCount: z.number().int().nonnegative(),
    }).strict(),
  },
  acknowledgeHumanMessage: {
    input: z.object({
      threadId,
      messageId: humanMessageIdSchema,
      expectedRevision: z.number().int().positive().optional(),
    }).strict(),
    output: humanMessageSchema,
  },
  setHumanMessageBookmark: {
    input: z.object({
      threadId,
      messageId: humanMessageIdSchema,
      bookmarked: z.boolean(),
      expectedRevision: z.number().int().positive().optional(),
    }).strict(),
    output: humanMessageSchema,
  },
} as const;

export const leaveHumanMessageSchema = z.object({
  subject: z.string().trim().max(160).optional(),
  body: z.string().trim().min(1).max(32 * 1024),
  idempotencyKey: z.string().trim().min(1).max(200).optional(),
}).strict();

export const readHumanMessagesSchema = z.object({
  messageId: humanMessageIdSchema.optional(),
  query: z.string().trim().max(1_000).optional(),
  limit: z.number().int().min(1).max(100).default(50),
  cursor: z.string().max(500).optional(),
}).strict();

export const updateHumanMessageSchema = z.object({
  messageId: humanMessageIdSchema,
  subject: z.string().trim().max(160).nullable().optional(),
  body: z.string().trim().min(1).max(32 * 1024).optional(),
  expectedRevision: z.number().int().positive().optional(),
}).strict().superRefine((value, context) => {
  if (value.subject === undefined && value.body === undefined)
    context.addIssue({ code: "custom", message: "Provide at least one content change." });
});

export type HumanMessage = z.infer<typeof humanMessageSchema>;
