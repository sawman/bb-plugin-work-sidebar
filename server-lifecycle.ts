export type GitHubApiHealth = {
  state: "available" | "rate_limited" | "unavailable";
  scope: "graphql" | "rest" | "unknown";
  message: string | null;
  retryAt: number | null;
};
export type GitHubPullRequestSignal = {
  checks: "failed" | "passing" | "pending" | "none" | "unknown";
  review:
    | "approved"
    | "changes_requested"
    | "changes_requested_review_requested"
    | "review_requested"
    | "review_required"
    | "none";
};
type ExpiringValue<T> = { expiresAt: number; value: T };
const MAX_GITHUB_PULL_REQUEST_SIGNALS = 300;

export class ServerLifecycle {
  readonly githubReadCache = new Map<
    string,
    { expiresAt: number; value: string }
  >();
  readonly githubReadPending = new Map<string, Promise<string>>();
  readonly githubPullRequestSignalCache = new Map<
    string,
    ExpiringValue<GitHubPullRequestSignal>
  >();
  readonly githubPullRequestSignalPending = new Map<
    string,
    Promise<GitHubPullRequestSignal | null>
  >();
  archivedThreadsCache: unknown = null;
  archivedThreadsPending: unknown = null;
  githubGraphqlHealth: GitHubApiHealth = {
    state: "available",
    scope: "graphql",
    message: null,
    retryAt: null,
  };
  githubRestHealth: GitHubApiHealth = {
    state: "available",
    scope: "rest",
    message: null,
    retryAt: null,
  };
  githubGraphqlBackoffUntil = 0;
  private disposed = false;

  get isDisposed(): boolean {
    return this.disposed;
  }

  cacheGitHubRead(key: string, value: string, expiresAt: number): void {
    if (!this.disposed) this.githubReadCache.set(key, { value, expiresAt });
  }

  cacheGitHubPullRequestSignal(
    key: string,
    value: GitHubPullRequestSignal,
    expiresAt: number,
  ): void {
    if (this.disposed) return;
    if (
      !this.githubPullRequestSignalCache.has(key) &&
      this.githubPullRequestSignalCache.size >= MAX_GITHUB_PULL_REQUEST_SIGNALS
    ) {
      this.githubPullRequestSignalCache.delete(
        this.githubPullRequestSignalCache.keys().next().value!,
      );
    }
    this.githubPullRequestSignalCache.set(key, { value, expiresAt });
  }

  releasePending(kind: "githubRead" | "pullRequestSignal", key: string): void {
    (kind === "githubRead"
      ? this.githubReadPending
      : this.githubPullRequestSignalPending
    ).delete(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.githubReadCache.clear();
    this.githubReadPending.clear();
    this.githubPullRequestSignalCache.clear();
    this.githubPullRequestSignalPending.clear();
    this.archivedThreadsCache = null;
    this.archivedThreadsPending = null;
    this.githubGraphqlHealth = {
      state: "available",
      scope: "graphql",
      message: null,
      retryAt: null,
    };
    this.githubRestHealth = {
      state: "available",
      scope: "rest",
      message: null,
      retryAt: null,
    };
    this.githubGraphqlBackoffUntil = 0;
  }

  inspect() {
    return {
      disposed: this.disposed,
      caches:
        this.githubReadCache.size +
        this.githubReadPending.size +
        this.githubPullRequestSignalCache.size +
        this.githubPullRequestSignalPending.size,
      archived:
        this.archivedThreadsCache !== null ||
        this.archivedThreadsPending !== null,
      backoffUntil: this.githubGraphqlBackoffUntil,
    };
  }
}

export function createServerLifecycle(): ServerLifecycle {
  return new ServerLifecycle();
}
