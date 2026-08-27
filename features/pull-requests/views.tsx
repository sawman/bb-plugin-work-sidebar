import type { ReactElement } from "react";

export function pullRequestChangesHeaderLabel({ isPending, isError, currentPullRequest }: { isPending: boolean; isError: boolean; currentPullRequest: { number: number } | null | undefined }): string {
  if (isPending) return "Loading…";
  if (isError) return "Unavailable";
  return currentPullRequest ? `#${currentPullRequest.number}` : "No PR";
}

export function PullRequestChangesError({ error, onRetry }: { error: Error; onRetry(): void }): ReactElement {
  return <div className="ws-callout" role="alert"><strong>Could not load pull request changes</strong><span>{error.message}</span><button type="button" aria-label="Retry pull request changes" onClick={onRetry}>Try again</button></div>;
}
