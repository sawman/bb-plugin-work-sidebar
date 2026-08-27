import type { ReactElement } from "react";

export function PullRequestChangesError({ error, onRetry }: { error: Error; onRetry(): void }): ReactElement {
  return <div className="ws-callout" role="alert"><strong>Could not load pull request changes</strong><span>{error.message}</span><button type="button" aria-label="Retry pull request changes" onClick={onRetry}>Try again</button></div>;
}
