import { z } from "zod";

export const pullRequestSignal = z.object({
  checks: z.enum(["failed", "passing", "pending", "none", "unknown"]),
  review: z.enum(["approved", "changes_requested", "changes_requested_review_requested", "review_requested", "review_required", "none"]),
  reviewCommentCount: z.number().int().nonnegative(),
});
