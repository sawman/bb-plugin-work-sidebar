/**
 * Real review-history shapes that must render identically in every PR surface.
 * They intentionally model decisions rather than any row-specific RPC shape.
 */
export const reviewLifecycleCorpus = [
  {
    name: "#1402 re-requests the same change requester",
    decision: "CHANGES_REQUESTED",
    requested: ["yojo-se"],
    reviewerStates: [["yojo-se", "CHANGES_REQUESTED"]],
    expected: "review_required",
  },
  {
    name: "a different reviewer request remains changes requested",
    decision: "CHANGES_REQUESTED",
    requested: ["someone-else"],
    reviewerStates: [["yojo-se", "CHANGES_REQUESTED"]],
    expected: "changes_requested",
  },
  {
    name: "#1408 retains approval after a later comment",
    decision: "APPROVED",
    requested: [],
    reviewerStates: [["hendra-systemearth", "APPROVED"]],
    expected: "approved",
  },
  {
    name: "#1221 keeps GitHub approval above historical change requests",
    decision: "APPROVED",
    requested: [],
    reviewerStates: [["yojo-se", "CHANGES_REQUESTED"]],
    expected: "approved",
  },
] as const;

export const commentedAfterApprovalHistory = [
  ["yojo-se", "APPROVED", "2026-08-31T15:25:13Z"],
  ["yojo-se", "COMMENTED", "2026-09-01T07:55:36Z"],
] as const;
