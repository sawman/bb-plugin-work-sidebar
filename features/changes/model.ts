import type { Changes, Repository } from "./schemas.js";

export const changesKeys = {
  projection: (threadId: string) => ["work-sidebar", "changes", threadId] as const,
  fingerprint: (threadId: string, url: string) => ["work-sidebar", "changes", threadId, "fingerprint", url] as const,
};
export const changesPolicies = {
  projection: { staleTime: 30_000, gcTime: 10 * 60_000, retry: false, refetchOnWindowFocus: false },
  fingerprint: { staleTime: 0, gcTime: 2 * 60_000, retry: false, refetchOnWindowFocus: false, refetchIntervalInBackground: true },
} as const;

export function repositoryPresentation(repository: Repository) {
  if (repository.outcome !== "available") return { label: "Unavailable", tone: "unavailable" as const };
  return repository.hasUncommittedChanges ? { label: "Changed", tone: "changed" as const } : { label: "Clean", tone: "clean" as const };
}

export function changesHeaderLabel(changes: Changes | undefined, pending: boolean, error: boolean) {
  if (pending) return "Loading…";
  if (error) return "Unavailable";
  return changes?.currentPullRequest ? `#${changes.currentPullRequest.number}` : "No PR";
}
