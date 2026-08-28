import { z } from "zod";

const agentThreadId = z.string().startsWith("thr_");

export const agentRpcSchemas = {
  getAgentDetails: {
    input: z.object({
      threadIds: z.array(agentThreadId).min(1).max(100).refine(
        (threadIds) => new Set(threadIds).size === threadIds.length,
        "threadIds must be unique",
      ),
    }).strict(),
    output: z.object({
      agents: z.array(z.object({
        threadId: agentThreadId,
        model: z.string().nullable(),
      }).strict()),
    }).strict(),
  },
} as const;
