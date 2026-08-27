import { z } from "zod";

export const pullRequestSignal = z.object({
  checks: z.enum(["failed", "passing", "pending", "none", "unknown"]),
  review: z.enum(["approved", "changes_requested", "changes_requested_review_requested", "review_requested", "review_required", "none"]),
  reviewCommentCount: z.number().int().nonnegative(),
});

// Browser-safe typed RPC payloads owned by the pull-request slice. The
// server-only `defineRpcContract` composition imports these schemas, never the
// other way around.
export const pullRequest = z.object({
  number: z.number(), title: z.string(), url: z.string(), state: z.enum(["closed", "draft", "merged", "open"]), head: z.string(), base: z.string(),
  checks: z.object({ failedCount: z.number(), passedCount: z.number(), pendingCount: z.number(), state: z.enum(["failing", "no_checks", "passing", "pending", "unknown"]), totalCount: z.number() }),
  review: z.object({ reviewRequestCount: z.number(), state: z.enum(["approved", "changes_requested", "none", "review_requested", "review_required"]) }),
  attention: z.enum(["blocked", "changes_requested", "checks_failed", "checks_pending", "closed", "conflicts", "draft", "merged", "none", "ready_to_merge", "review_requested"]),
  mergeability: z.object({ mergeStateStatus: z.enum(["BEHIND", "BLOCKED", "CLEAN", "DRAFT", "HAS_HOOKS", "DIRTY", "UNKNOWN", "UNSTABLE"]).nullable(), mergeable: z.enum(["CONFLICTING", "MERGEABLE", "UNKNOWN"]).nullable(), state: z.enum(["blocked", "conflicts", "draft", "mergeable", "unknown"]) }),
  signal: pullRequestSignal,
});
export const sidebarStackLayer = pullRequestSignal.extend({ number: z.number().int().positive(), title: z.string(), state: z.string(), draft: z.boolean(), url: z.string(), head: z.string(), base: z.string(), attention: z.string().nullable().optional() });
export const sidebarStack = z.object({ id: z.string(), number: z.number().int().positive().nullable(), base: z.string(), currentPullRequest: z.number().int().positive().nullable(), pullRequests: z.array(sidebarStackLayer) });
export const authoredPullRequest = pullRequestSignal.extend({ number: z.number().int().positive(), title: z.string(), url: z.string().url(), repository: z.string(), state: z.enum(["open", "draft"]), draft: z.boolean(), head: z.string(), base: z.string(), stack: sidebarStack.nullable() });

export type PullRequestContract = z.infer<typeof pullRequest>;
export type AuthoredPullRequestContract = z.infer<typeof authoredPullRequest>;
