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

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.githubReadCache.clear();
    this.githubReadPending.clear();
    this.githubPullRequestSignalCache.clear();
    this.githubPullRequestSignalPending.clear();
    this.archivedThreadsCache = null;
    this.archivedThreadsPending = null;
  }

  inspect() {
    return { disposed: this.disposed, timers: 0, subscriptions: 0, caches: this.githubReadCache.size + this.githubReadPending.size + this.githubPullRequestSignalCache.size + this.githubPullRequestSignalPending.size };
  }
}

export function createServerLifecycle(): ServerLifecycle { return new ServerLifecycle(); }
