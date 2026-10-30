import { isVisibleAuthoredPullRequest } from "./presentation.js";

import { classifyPullRequestError, type PullRequestHealth } from "./health.js";
export { classifyPullRequestError, type PullRequestHealth } from "./health.js";
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

export class PullRequestService<T extends AuthoredPullRequestRecord> {
  private authoredCache: CacheEntry<T[]> | null = null;
  private authoredPending: Promise<T[]> | null = null;
  private stacksPending: Promise<T[]> | null = null;
  private stacksRepositories: Set<string> | null = null;
  private stacksGeneration = 0;
  private disposed = false;
  private generation = 0;

  constructor(private readonly options: Options<T>) {}

  private visible(items: T[], archivedRepositories: ReadonlySet<string>): T[] {
    return items.filter((item) => isVisibleAuthoredPullRequest({ repository: item.repository, archivedRepositories }));
  }

  async authored(force = false): Promise<T[]> {
    if (this.disposed) throw new Error("Pull-request service is disposed");
    if (force) this.clear();
    if (!force && this.authoredCache && this.authoredCache.expiresAt > this.options.now()) return this.authoredCache.value;
    if (!force && this.authoredPending) return this.authoredPending;
    const generation = this.generation;
    const pending = this.options.readAuthored().then(async (items) => this.visible(items, await this.options.archivedRepositories(items)))
      .then((items) => {
        if (!this.disposed && generation === this.generation) this.authoredCache = { value: items, expiresAt: this.options.now() + AUTHORED_TTL };
        return items;
      })
      .finally(() => { if (this.authoredPending === pending) this.authoredPending = null; });
    this.authoredPending = pending;
    return pending;
  }

  async stacks(force = false): Promise<T[]> {
    if (this.disposed) throw new Error("Pull-request service is disposed");
    if (force) this.clear();
    if (!force && this.stacksPending) return this.stacksPending;
    // Settled topology belongs to the shared repository reader; dedupe only
    // concurrent authored projections so a remote clear cannot leave a mirror.
    const generation = this.stacksGeneration;
    const pending = this.authored().then((items) => {
      if (this.disposed || generation !== this.stacksGeneration) throw new Error("Authored topology changed during the read.");
      this.stacksRepositories = new Set(items.map((item) => item.repository.toLowerCase()));
      return this.options.readStacks(items);
    }).then((items) => {
      if (this.disposed || generation !== this.stacksGeneration) throw new Error("Authored topology changed during the read.");
      return items;
    }).finally(() => { if (this.stacksPending === pending) { this.stacksPending = null; this.stacksRepositories = null; } });
    this.stacksPending = pending;
    return pending;
  }

  async setDraft(url: string, draft: boolean) {
    if (this.disposed) throw new Error("Pull-request service is disposed");
    const result = await this.options.setDraft(url, draft);
    if (this.disposed) throw new Error("Pull-request service is disposed");
    this.clear();
    return result;
  }

  invalidateStacks(repository: string | null = null): void {
    if (repository && !this.stacksRepositories?.has(repository.toLowerCase())) return;
    this.stacksGeneration++;
    this.stacksPending = null;
    this.stacksRepositories = null;
  }

  clear(): void {
    this.generation += 1;
    this.authoredCache = null;
    // A late completion still resolves its original caller, but no normal
    // read may join work from the generation this clear replaced.
    this.authoredPending = null;
    this.invalidateStacks();
  }
  dispose(): void { this.disposed = true; this.clear(); this.authoredPending = null; this.stacksPending = null; }
  classifyError(error: unknown, scope: PullRequestHealth["scope"]): PullRequestHealth {
    return classifyPullRequestError(error, scope, this.options.now);
  }
  inspect() { return { disposed: this.disposed, authoredCached: this.authoredCache !== null, stacksCached: false, pending: Number(this.authoredPending !== null) + Number(this.stacksPending !== null) }; }
}

export function createPullRequestService<T extends AuthoredPullRequestRecord>(options: Options<T>) { return new PullRequestService(options); }
