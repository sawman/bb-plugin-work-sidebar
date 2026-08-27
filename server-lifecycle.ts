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
  readonly timers = new Set<unknown>();
  readonly subscriptions = new Set<() => void>();
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
    this.githubGraphqlHealth = { state: "available", scope: "graphql", message: null, retryAt: null };
    this.githubRestHealth = { state: "available", scope: "rest", message: null, retryAt: null };
    this.githubGraphqlBackoffUntil = 0;
    this.timers.clear();
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions.clear();
  }

  inspect() {
    return { disposed: this.disposed, timers: this.timers.size, subscriptions: this.subscriptions.size, caches: this.githubReadCache.size + this.githubReadPending.size + this.githubPullRequestSignalCache.size + this.githubPullRequestSignalPending.size, archived: this.archivedThreadsCache !== null || this.archivedThreadsPending !== null, backoffUntil: this.githubGraphqlBackoffUntil };
  }

  seedForTest(): void {
    this.githubReadCache.set("read", { expiresAt: Infinity, value: "cached" });
    this.githubReadPending.set("read", Promise.resolve("pending"));
    this.githubPullRequestSignalCache.set("signal", { expiresAt: Infinity, value: "cached" });
    this.githubPullRequestSignalPending.set("signal", Promise.resolve(null));
    this.archivedThreadsCache = { expiresAt: Infinity, value: [] };
    this.archivedThreadsPending = Promise.resolve([]);
    this.githubGraphqlHealth = { state: "rate_limited", scope: "graphql", message: "limited", retryAt: 1 };
    this.githubRestHealth = { state: "unavailable", scope: "rest", message: "unavailable", retryAt: null };
    this.githubGraphqlBackoffUntil = 1;
    this.timers.add("timer");
    this.subscriptions.add(() => undefined);
  }
}

export function createServerLifecycle(): ServerLifecycle { return new ServerLifecycle(); }
