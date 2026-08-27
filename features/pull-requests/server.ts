import { isVisibleAuthoredPullRequest } from "./presentation.js";

export type PullRequestHealth = { state: "available" | "rate_limited" | "unavailable"; scope: "graphql" | "rest" | "unknown"; message: string | null; retryAt: number | null };
export type AuthoredPullRequestRecord = { repository: string };

type CacheEntry<T> = { expiresAt: number; value: T };
type Options<T extends AuthoredPullRequestRecord> = {
  now(): number;
  readAuthored(): Promise<T[]>;
  readStacks(items: T[]): Promise<T[]>;
  archivedRepositories(items: T[]): Promise<ReadonlySet<string>>;
  setDraft(url: string, draft: boolean): Promise<{ draft: boolean }>;
};

const AUTHORED_TTL = 5 * 60_000;

export function classifyPullRequestError(error: unknown, scope: PullRequestHealth["scope"], now: () => number = Date.now): PullRequestHealth {
  const message = error instanceof Error ? error.message : String(error);
  const rateLimited = /graphql_rate_limit|API rate limit already exceeded|secondary rate limit|rate limit/i.test(message);
  if (rateLimited) {
    return {
      state: "rate_limited",
      scope,
      message: scope === "graphql" ? "GitHub GraphQL is rate limited; using REST where possible." : "GitHub REST API is rate limited.",
      retryAt: now() + 60 * 60_000,
    };
  }
  return {
    state: "unavailable",
    scope,
    message: `GitHub ${scope === "graphql" ? "GraphQL" : "REST"} request failed.`,
    retryAt: null,
  };
}

export class PullRequestService<T extends AuthoredPullRequestRecord> {
  private authoredCache: CacheEntry<T[]> | null = null;
  private stacksCache: CacheEntry<T[]> | null = null;
  private authoredPending: Promise<T[]> | null = null;
  private stacksPending: Promise<T[]> | null = null;
  private disposed = false;

  constructor(private readonly options: Options<T>) {}

  private visible(items: T[], archivedRepositories: ReadonlySet<string>): T[] {
    return items.filter((item) => isVisibleAuthoredPullRequest({ repository: item.repository, archivedRepositories }));
  }

  async authored(force = false): Promise<T[]> {
    if (this.disposed) throw new Error("Pull-request service is disposed");
    if (!force && this.authoredCache && this.authoredCache.expiresAt > this.options.now()) return this.authoredCache.value;
    if (!force && this.authoredPending) return this.authoredPending;
    const pending = this.options.readAuthored().then(async (items) => this.visible(items, await this.options.archivedRepositories(items)))
      .then((items) => {
        if (!this.disposed) this.authoredCache = { value: items, expiresAt: this.options.now() + AUTHORED_TTL };
        return items;
      })
      .finally(() => { if (this.authoredPending === pending) this.authoredPending = null; });
    this.authoredPending = pending;
    return pending;
  }

  async stacks(force = false): Promise<T[]> {
    if (this.disposed) throw new Error("Pull-request service is disposed");
    if (!force && this.stacksCache && this.stacksCache.expiresAt > this.options.now()) return this.stacksCache.value;
    if (!force && this.stacksPending) return this.stacksPending;
    const pending = this.authored(force).then((items) => this.options.readStacks(items)).then((items) => {
      if (!this.disposed) this.stacksCache = { value: items, expiresAt: this.options.now() + AUTHORED_TTL };
      return items;
    }).finally(() => { if (this.stacksPending === pending) this.stacksPending = null; });
    this.stacksPending = pending;
    return pending;
  }

  async setDraft(url: string, draft: boolean) {
    const result = await this.options.setDraft(url, draft);
    this.clear();
    return result;
  }

  clear(): void { this.authoredCache = null; this.stacksCache = null; }
  dispose(): void { this.disposed = true; this.clear(); this.authoredPending = null; this.stacksPending = null; }
  classifyError(error: unknown, scope: PullRequestHealth["scope"]): PullRequestHealth {
    return classifyPullRequestError(error, scope, this.options.now);
  }
  clientRetryAllowed(error: unknown): boolean { return this.classifyError(error, "unknown").state !== "rate_limited"; }
  inspect() { return { disposed: this.disposed, authoredCached: this.authoredCache !== null, stacksCached: this.stacksCache !== null, pending: Number(this.authoredPending !== null) + Number(this.stacksPending !== null) }; }
}

export function createPullRequestService<T extends AuthoredPullRequestRecord>(options: Options<T>) { return new PullRequestService(options); }
