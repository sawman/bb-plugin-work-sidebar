import { z } from "zod";

export const pullRequestSignal = z.object({
  checks: z.enum(["failed", "passing", "pending", "none", "unknown"]),
  review: z.enum([
    "approved",
    "changes_requested",
    "review_requested",
    "review_required",
    "none",
  ]),
  requestedReviewers: z.array(z.string()).optional(),
  reviewCommentCount: z.number().int().nonnegative(),
});

// Browser-safe typed RPC payloads owned by the pull-request slice. The
// server-only `defineRpcContract` composition imports these schemas, never the
// other way around.
export const pullRequest = z.object({
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
    state: z.enum([
      "approved",
      "changes_requested",
      "none",
      "review_requested",
      "review_required",
    ]),
  }),
  attention: z.enum([
    "approved",
    "blocked",
    "changes_requested",
    "checks_failed",
    "checks_pending",
    "closed",
    "conflicts",
    "draft",
    "merged",
    "none",
    "ready_to_merge",
    "review_requested",
  ]),
  mergeability: z.object({
    mergeStateStatus: z
      .enum([
        "BEHIND",
        "BLOCKED",
        "CLEAN",
        "DRAFT",
        "HAS_HOOKS",
        "DIRTY",
        "UNKNOWN",
        "UNSTABLE",
      ])
      .nullable(),
    mergeable: z.enum(["CONFLICTING", "MERGEABLE", "UNKNOWN"]).nullable(),
    state: z.enum(["blocked", "conflicts", "draft", "mergeable", "unknown"]),
  }),
  signal: pullRequestSignal,
});

/** A normalized PR fact plus the thread-local stack position that discovered it. */
export const threadPullRequest = pullRequest.extend({
  stackNumber: z.number().int().positive().nullable(),
});
export const sidebarStackLayer = pullRequestSignal.extend({
  number: z.number().int().positive(),
  title: z.string(),
  state: z.string(),
  draft: z.boolean(),
  url: z.string(),
  head: z.string(),
  base: z.string(),
  attention: z.string().nullable().optional(),
});
export const sidebarStack = z.object({
  id: z.string(),
  number: z.number().int().positive().nullable(),
  base: z.string(),
  currentPullRequest: z.number().int().positive().nullable(),
  pullRequests: z.array(sidebarStackLayer),
});
export const authoredPullRequest = pullRequestSignal.extend({
  number: z.number().int().positive(),
  title: z.string(),
  url: z.string().url(),
  repository: z.string(),
  state: z.enum(["open", "draft"]),
  draft: z.boolean(),
  head: z.string(),
  base: z.string(),
  stack: sidebarStack.nullable(),
});

export const pullRequestReviewer = z
  .object({
    login: z.string(),
    name: z.string().nullable(),
    avatarUrl: z.string().url().nullable(),
  })
  .strict();

const githubApiLimit = z
  .object({
    limit: z.number().int().nonnegative(),
    remaining: z.number().int().nonnegative(),
    resetAt: z.number().int().nullable(),
  })
  .strict();

export const githubApiHealth = z
  .object({
    state: z.enum(["available", "rate_limited", "unavailable"]),
    scope: z.enum(["graphql", "rest", "unknown"]),
    message: z.string().nullable(),
    retryAt: z.number().nullable(),
    limits: z
      .object({ graphql: githubApiLimit.nullable(), rest: githubApiLimit.nullable() })
      .strict()
      .optional(),
  })
  .strict();

const repositoryName = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);
const reviewerLogin = z
  .string()
  .min(1)
  .max(39)
  .regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/);

export const pullRequestReviewerRpcSchemas = {
  getPullRequestReviewers: {
    input: z
      .object({ repository: repositoryName, force: z.boolean().optional() })
      .strict(),
    output: z
      .object({
        available: z.boolean(),
        reviewers: z.array(pullRequestReviewer),
        error: z.string().nullable(),
      })
      .strict(),
  },
  updatePullRequestReviewers: {
    input: z
      .object({
        repository: repositoryName,
        number: z.number().int().positive(),
        reviewers: z.array(reviewerLogin).max(100),
      })
      .strict(),
    output: z.object({ reviewers: z.array(reviewerLogin) }).strict(),
  },
} as const;

export type PullRequestContract = z.infer<typeof pullRequest>;
export type ThreadPullRequestContract = z.infer<typeof threadPullRequest>;
export type AuthoredPullRequestContract = z.infer<typeof authoredPullRequest>;
export type PullRequestReviewerContract = z.infer<typeof pullRequestReviewer>;
