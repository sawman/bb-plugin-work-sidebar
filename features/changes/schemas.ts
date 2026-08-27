import { z } from "zod";
import { pullRequest, sidebarStackLayer } from "../pull-requests/schemas.js";

export const workingTreeFileSchema = z.object({
  path: z.string(),
  status: z.string(),
  insertions: z.number().nullable(),
  deletions: z.number().nullable(),
});
export const repositorySchema = z.object({
  outcome: z.enum(["available", "not_applicable", "unavailable", "absent"]),
  message: z.string().nullable(),
  branch: z.string().nullable(),
  base: z.string().nullable(),
  ahead: z.number(),
  behind: z.number(),
  worktreeState: z.string().nullable(),
  hasUncommittedChanges: z.boolean(),
  changedFileCount: z.number().int().nonnegative(),
  changedInsertions: z.number().int().nonnegative(),
  changedDeletions: z.number().int().nonnegative(),
  changedFiles: z.array(workingTreeFileSchema),
});
export const stackDiffFileSchema = z.object({
  path: z.string(),
  previousPath: z.string().nullable(),
  status: z.enum(["added", "deleted", "modified", "renamed", "untracked"]),
  additions: z.number().nullable(),
  deletions: z.number().nullable(),
});
const stackChange = z.object({
  additions: z.number(),
  deletions: z.number(),
  files: z.array(stackDiffFileSchema),
  truncated: z.boolean(),
});
export const githubStackBranchSchema = z.object({
  name: z.string(),
  isCurrent: z.boolean(),
  isMerged: z.boolean(),
  isQueued: z.boolean(),
  needsRebase: z.boolean(),
  hasStash: z.boolean(),
  stashCount: z.number().int().nonnegative().nullable(),
  pr: z
    .object({
      number: z.number(),
      url: z.string().url(),
      state: z.string(),
      title: z.string().nullable(),
      isDraft: z.boolean(),
      metadataStale: z.boolean(),
    })
    .nullable(),
  diff: stackChange.nullable(),
  aheadOfRemote: z.number().nullable(),
  behindRemote: z.number().nullable(),
  checks: z
    .enum(["failed", "passing", "pending", "none", "unknown"])
    .optional(),
  review: z
    .enum([
      "approved",
      "changes_requested",
      "changes_requested_review_requested",
      "review_requested",
      "review_required",
      "none",
    ])
    .optional(),
});
const githubStackSchema = z.object({
  trunk: z.string(),
  currentBranch: z.string().nullable(),
  branches: z.array(githubStackBranchSchema),
  trunkBehind: z.number().nullable(),
  prunableBranchCount: z.number().int().nonnegative().nullable(),
});
export const changesSchema = z.object({
  currentPullRequest: pullRequest.nullable(),
  stack: z
    .object({
      number: z.number(),
      base: z.string(),
      currentPullRequest: z.number(),
      pullRequests: z.array(sidebarStackLayer),
    })
    .nullable(),
  stackUnavailableReason: z.string().nullable(),
  githubStack: z
    .object({
      stack: githubStackSchema.nullable(),
      pending: stackChange.nullable(),
      error: z.string().nullable(),
    })
    .nullable(),
  repository: repositorySchema,
});
const threadInput = z
  .object({ threadId: z.string().startsWith("thr_") })
  .strict();
export const checkoutStackBranchResultSchema = z
  .object({
    ok: z.boolean(),
    message: z.string(),
    tone: z.enum(["success", "warning", "error"]).optional(),
    detail: z.string().nullable(),
  })
  .strict();
export const workingTreeFileDiffSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("patch"),
      path: z.string().min(1),
      patch: z.string().min(1),
      message: z.null(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("binary"),
      path: z.string().min(1),
      patch: z.null(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("absent"),
      path: z.string().min(1),
      patch: z.null(),
      message: z.string(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("unavailable"),
      path: z.string().min(1),
      patch: z.null(),
      message: z.string(),
    })
    .strict(),
]);
export const changesRpcSchemas = {
  getChanges: { input: threadInput, output: changesSchema },
  getChangesFingerprint: {
    input: z
      .object({
        threadId: z.string().startsWith("thr_"),
        url: z.string().url(),
      })
      .strict(),
    output: z.object({ fingerprint: z.string().nullable() }),
  },
  checkoutStackBranch: {
    input: z
      .object({
        threadId: z.string().startsWith("thr_"),
        branch: z.string().min(1).max(255),
      })
      .strict(),
    output: checkoutStackBranchResultSchema,
  },
  getWorkingTreeFileDiff: {
    input: z
      .object({
        threadId: z.string().startsWith("thr_"),
        path: z.string().min(1),
      })
      .strict(),
    output: workingTreeFileDiffSchema,
  },
};
export type Changes = z.infer<typeof changesSchema>;
export type Repository = z.infer<typeof repositorySchema>;
export type CheckoutStackBranchResult = z.infer<
  typeof checkoutStackBranchResultSchema
>;
export type WorkingTreeFileDiff = z.infer<typeof workingTreeFileDiffSchema>;
