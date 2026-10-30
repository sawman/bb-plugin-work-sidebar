export type GitHubApiHealth = {
  state: "available" | "rate_limited" | "unavailable";
  scope: "graphql" | "rest" | "unknown";
  message: string | null;
  retryAt: number | null;
};
export type GitHubPullRequestSignal = import("./features/pull-requests/server-types.js").GitHubSignal;
export type GitHubReadPending = Promise<string> & { validatedAt?: number; sequence?: number };
export type LegacyWorkContext = {
  state: "none" | "adoptable" | "ambiguous" | "project_mismatch";
  taskIds: string[];
  message: string | null;
};
type ExpiringValue<T> = { expiresAt: number; value: T };
type LegacyWorkPending = {
  generation: number;
  promise: Promise<LegacyWorkContext>;
};
const MAX_GITHUB_PULL_REQUEST_SIGNALS = 300;
export const MAX_LEGACY_WORK_CACHE = 128;

type DisposableService = { dispose(): void };

export class ServerLifecycle {
  readonly observationEpoch = Math.random().toString(36).slice(2);
  private observationSequence = 0;
  nextObservationSequence() { return ++this.observationSequence; }
  remoteRevision = 0;
  private remoteSequence = 0;
  private readonly remoteRepositoryGenerations = new Map<string, number>();
  remoteGeneration(repository: string) {
    if (this.disposed) return `${this.remoteRevision}:disposed`;
    const key = repository.toLowerCase();
    let generation = this.remoteRepositoryGenerations.get(key);
    if (generation === undefined) generation = ++this.remoteSequence;
    this.remoteRepositoryGenerations.delete(key);
    if (this.remoteRepositoryGenerations.size >= 128)
      this.remoteRepositoryGenerations.delete(this.remoteRepositoryGenerations.keys().next().value!);
    this.remoteRepositoryGenerations.set(key, generation);
    return `${this.remoteRevision}:${generation}`;
  }
  private readonly remoteInvalidators = new Set<(repository: string | null) => void>();
  onRemoteInvalidated(invalidate: (repository: string | null) => void) {
    this.remoteInvalidators.add(invalidate);
    this.own({ dispose: () => { this.remoteInvalidators.delete(invalidate); } });
  }
  invalidateRemoteCaches(repository: string | null) {
    if (repository) this.remoteRepositoryGenerations.delete(repository.toLowerCase());
    else { this.remoteRevision++; this.remoteRepositoryGenerations.clear(); }
    for (const invalidate of this.remoteInvalidators) invalidate(repository);
  }
  readonly githubReadCache = new Map<
    string,
    { expiresAt: number; value: string; validatedAt?: number | null; sequence?: number }
  >();
  readonly githubReadPending = new Map<string, GitHubReadPending>();
  readonly githubPullRequestSignalCache = new Map<
    string,
    ExpiringValue<GitHubPullRequestSignal>
  >();
  readonly githubPullRequestSignalPending = new Map<
    string,
    import("./features/pull-requests/signal-validation.js").PendingSignalValidation
  >();
  readonly legacyWorkCache = new Map<string, ExpiringValue<LegacyWorkContext>>();
  readonly legacyWorkPending = new Map<string, LegacyWorkPending>();
  private readonly legacyWorkGenerations = new Map<string, number>();
  private readonly legacyWorkInFlight = new Map<
    string,
    Set<LegacyWorkPending>
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
  private readonly ownedServices = new Set<DisposableService>();

  get isDisposed(): boolean {
    return this.disposed;
  }

  own<T extends DisposableService>(service: T): T {
    if (this.disposed) {
      service.dispose();
      throw new Error("Server lifecycle is disposed.");
    }
    this.ownedServices.add(service);
    return service;
  }

  cacheGitHubRead(key: string, value: string, expiresAt: number, validatedAt: number | null = null, sequence?: number): void {
    if (this.disposed) return;
    for (const [entryKey, entry] of this.githubReadCache)
      if (entry.expiresAt <= Date.now()) this.githubReadCache.delete(entryKey);
    const byteLimit = 16 * 1024 * 1024;
    const bytes = Buffer.byteLength(value);
    if (bytes > byteLimit) return;
    this.githubReadCache.delete(key);
    let retainedBytes = [...this.githubReadCache.values()].reduce((total, entry) => total + Buffer.byteLength(entry.value), 0);
    while (retainedBytes + bytes > byteLimit && this.githubReadCache.size) {
      const oldest = this.githubReadCache.keys().next().value!;
      retainedBytes -= Buffer.byteLength(this.githubReadCache.get(oldest)!.value);
      this.githubReadCache.delete(oldest);
    }
    this.githubReadCache.set(key, { value, expiresAt, validatedAt, sequence });
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

  private pruneLegacyWorkCache(now: number): void {
    for (const [key, entry] of this.legacyWorkCache)
      if (entry.expiresAt <= now) this.legacyWorkCache.delete(key);
  }

  private cacheLegacyWork(
    key: string,
    value: LegacyWorkContext,
    ttlMs: number,
  ): void {
    const now = Date.now();
    this.pruneLegacyWorkCache(now);
    if (
      !this.legacyWorkCache.has(key) &&
      this.legacyWorkCache.size >= MAX_LEGACY_WORK_CACHE
    )
      this.legacyWorkCache.delete(this.legacyWorkCache.keys().next().value!);
    this.legacyWorkCache.set(key, {
      value,
      expiresAt: now + ttlMs,
    });
  }

  private releaseLegacyWorkPending(
    key: string,
    pending: LegacyWorkPending,
  ): void {
    if (this.legacyWorkPending.get(key) === pending)
      this.legacyWorkPending.delete(key);
    const inFlight = this.legacyWorkInFlight.get(key);
    if (!inFlight) return;
    inFlight.delete(pending);
    if (inFlight.size) return;
    this.legacyWorkInFlight.delete(key);
    this.legacyWorkGenerations.delete(key);
  }

  /** Memoizes one legacy work probe and retries one superseding generation. */
  async readLegacyWork(
    key: string,
    ttlMs: number,
    load: () => Promise<LegacyWorkContext>,
    retriesRemaining = 1,
  ): Promise<LegacyWorkContext> {
    if (this.disposed)
      throw new Error("Legacy work discovery lifecycle is disposed.");
    const now = Date.now();
    this.pruneLegacyWorkCache(now);
    const cached = this.legacyWorkCache.get(key);
    if (cached) {
      this.legacyWorkCache.delete(key);
      this.legacyWorkCache.set(key, cached);
      return cached.value;
    }
    const generation = this.legacyWorkGenerations.get(key) ?? 0;
    const existing = this.legacyWorkPending.get(key);
    if (existing && existing.generation === generation) return existing.promise;

    let pending!: LegacyWorkPending;
    const promise = Promise.resolve()
      .then(load)
      .then((value) => {
        if (this.disposed)
          throw new Error("Legacy work discovery lifecycle is disposed.");
        if ((this.legacyWorkGenerations.get(key) ?? 0) !== generation) {
          if (!retriesRemaining)
            throw new Error(
              "Legacy work changed repeatedly while resolving. Retry the operation.",
            );
          return this.readLegacyWork(key, ttlMs, load, retriesRemaining - 1);
        }
        this.cacheLegacyWork(key, value, ttlMs);
        return value;
      })
      .finally(() => {
        this.releaseLegacyWorkPending(key, pending);
      });
    pending = { generation, promise };
    this.legacyWorkPending.set(key, pending);
    const inFlight = this.legacyWorkInFlight.get(key) ?? new Set();
    inFlight.add(pending);
    this.legacyWorkInFlight.set(key, inFlight);
    return promise;
  }

  /** Rejects cached and in-flight results from a superseded legacy probe. */
  invalidateLegacyWork(key: string): void {
    if (this.disposed) return;
    const inFlight = this.legacyWorkInFlight.get(key);
    if (inFlight?.size)
      this.legacyWorkGenerations.set(
        key,
        (this.legacyWorkGenerations.get(key) ?? 0) + 1,
      );
    else this.legacyWorkGenerations.delete(key);
    this.legacyWorkCache.delete(key);
    this.legacyWorkPending.delete(key);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const service of this.ownedServices) service.dispose();
    this.ownedServices.clear();
    this.remoteRepositoryGenerations.clear();
    this.githubReadCache.clear();
    this.githubReadPending.clear();
    this.githubPullRequestSignalCache.clear();
    this.githubPullRequestSignalPending.clear();
    this.legacyWorkCache.clear();
    this.legacyWorkPending.clear();
    this.legacyWorkGenerations.clear();
    this.legacyWorkInFlight.clear();
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
        this.githubPullRequestSignalPending.size +
        this.legacyWorkCache.size +
        this.legacyWorkPending.size,
      archived:
        this.archivedThreadsCache !== null ||
        this.archivedThreadsPending !== null,
      backoffUntil: this.githubGraphqlBackoffUntil,
    };
  }

  inspectLegacyWork() {
    return {
      cached: this.legacyWorkCache.size,
      pending: this.legacyWorkPending.size,
      generations: this.legacyWorkGenerations.size,
    };
  }
}

export function createServerLifecycle(): ServerLifecycle {
  return new ServerLifecycle();
}
