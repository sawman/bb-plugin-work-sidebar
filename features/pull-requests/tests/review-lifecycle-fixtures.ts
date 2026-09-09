/**
 * Representative review-history shapes that must render identically in every PR surface.
 * They intentionally model decisions rather than any row-specific RPC shape.
 */
export const reviewLifecycleCorpus = [
  {
    name: "a re-request from the same change requester requires review",
    decision: "CHANGES_REQUESTED",
    requested: ["reviewer-a"],
    reviewerStates: [["reviewer-a", "CHANGES_REQUESTED"]],
    expected: "review_required",
  },
  {
    name: "a different reviewer request remains changes requested",
    decision: "CHANGES_REQUESTED",
    requested: ["someone-else"],
    reviewerStates: [["reviewer-a", "CHANGES_REQUESTED"]],
    expected: "changes_requested",
  },
  {
    name: "approval survives a later comment",
    decision: "APPROVED",
    requested: [],
    reviewerStates: [["reviewer-b", "APPROVED"]],
    expected: "approved",
  },
  {
    name: "GitHub approval overrides historical change requests",
    decision: "APPROVED",
    requested: [],
    reviewerStates: [["reviewer-a", "CHANGES_REQUESTED"]],
    expected: "approved",
  },
] as const;

export const commentedAfterApprovalHistory = [
  ["reviewer-a", "APPROVED", "2026-08-31T15:25:13Z"],
  ["reviewer-a", "COMMENTED", "2026-09-01T07:55:36Z"],
] as const;
