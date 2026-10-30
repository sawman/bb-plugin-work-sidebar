import type { PullRequestObservations } from "../../features/pull-requests/schemas";

/** Explicit upstream observations for ordering tests; never a hydration clock. */
export function prObservations(validatedAt: number, groups: (keyof PullRequestObservations)[] = [
  "title", "lifecycle", "head", "base", "checks", "checkCounts", "review", "people", "comments", "mergeability",
]): PullRequestObservations {
  const clock = { source: "github" as const, validatedAt, headSha: "head", baseSha: "base", reviewIdentity: "review-1", updatedAt: "2026-10-30T00:00:00Z" };
  return Object.fromEntries(groups.map((group) => [group, clock]));
}
