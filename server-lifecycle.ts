export type GitHubApiHealth = { state: "available" | "rate_limited" | "unavailable"; scope: "graphql" | "rest" | "unknown"; message: string | null; retryAt: number | null };

export class ServerLifecycle {
  readonly githubReadCache = new Map<string, { expiresAt: number; value: string }>();
  readonly githubReadPending = new Map<string, Promise<string>>();
  readonly githubPullRequestSignalCache = new Map<string, unknown>();
  readonly githubPullRequestSignalPending = new Map<string, unknown>();
  archivedThreadsCache: unknown = null;
  archivedThreadsPending: unknown = null;
  githubGraphqlHealth: GitHubApiHealth = { state: "available", scope: "graphql", message: null, retryAt: null };
  githubRestHealth: GitHubApiHealth = { state: "available", scope: "rest", message: null, retryAt: null };
  githubGraphqlBackoffUntil = 0;
  private disposed = false;

  releasePending(kind: "githubRead" | "pullRequestSignal", key: string): void {
    (kind === "githubRead" ? this.githubReadPending : this.githubPullRequestSignalPending).delete(key);
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
    this.githubGraphqlHealth = { state: "available", scope: "graphql", message: null, retryAt: null };
    this.githubRestHealth = { state: "available", scope: "rest", message: null, retryAt: null };
    this.githubGraphqlBackoffUntil = 0;
  }

  inspect() {
    return { disposed: this.disposed, caches: this.githubReadCache.size + this.githubReadPending.size + this.githubPullRequestSignalCache.size + this.githubPullRequestSignalPending.size, archived: this.archivedThreadsCache !== null || this.archivedThreadsPending !== null, backoffUntil: this.githubGraphqlBackoffUntil };
  }
}

export function createServerLifecycle(): ServerLifecycle { return new ServerLifecycle(); }
