import type { GitHubApiHealth, ServerLifecycle } from "../../server-lifecycle.js";

export type GitHubReadScope = "graphql" | "rest";
export type GitHubCommand = (args: readonly string[], maxBuffer: number) => Promise<string>;
export type GitHubErrorClassifier = (error: unknown, scope: GitHubReadScope) => GitHubApiHealth;
export type GitHubReadPolicy = {
  afterSequence?: number;
  onValidation?: (validatedAt: number | null, sequence?: number) => void;
};

const GRAPHQL_BACKOFF_MS = 60 * 60_000;

function scopeFor(args: readonly string[]): GitHubReadScope {
  return args[0] === "api" && args[1] === "graphql" ? "graphql" : "rest";
}

export function githubReadHealth(lifecycle: ServerLifecycle): GitHubApiHealth {
  if (lifecycle.githubGraphqlHealth.state !== "available") return lifecycle.githubGraphqlHealth;
  if (lifecycle.githubRestHealth.state !== "available") return lifecycle.githubRestHealth;
  return { state: "available", scope: "unknown", message: null, retryAt: null };
}

export function clearGitHubReadCache(lifecycle: ServerLifecycle, repository: string | null = null): void {
  const normalized = repository?.toLowerCase();
  const matches = (key: string) => !normalized || key.toLowerCase().includes(`repos/${normalized}/`)
    || key.startsWith("api\u0000graphql") || key.toLowerCase().startsWith(`${normalized}#`);
  for (const entries of [lifecycle.githubReadCache, lifecycle.githubReadPending,
    lifecycle.githubPullRequestSignalCache, lifecycle.githubPullRequestSignalPending])
    for (const key of entries.keys()) if (matches(key)) entries.delete(key);
  lifecycle.invalidateRemoteCaches(normalized ?? null);
}

function recordGitHubReadSuccess(
  lifecycle: ServerLifecycle,
  scope: GitHubReadScope,
  key: string,
  stdout: string,
  ttlMs: number,
  validatedAt: number,
  sequence: number,
): string {
  if (lifecycle.isDisposed) return stdout;
  recordGitHubReadAvailability(lifecycle, scope);
  if (lifecycle.githubReadCache.size >= 300) lifecycle.githubReadCache.delete(lifecycle.githubReadCache.keys().next().value!);
  if (ttlMs > 0) lifecycle.cacheGitHubRead(key, stdout, Date.now() + ttlMs, validatedAt, sequence);
  return stdout;
}

function recordGitHubReadAvailability(lifecycle: ServerLifecycle, scope: GitHubReadScope): void {
  if (scope === "graphql") {
    lifecycle.githubGraphqlHealth = { state: "available", scope, message: null, retryAt: null };
    return;
  }
  lifecycle.githubRestHealth = { state: "available", scope, message: null, retryAt: null };
}

function asGitHubReadError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function recordGitHubReadHealth(lifecycle: ServerLifecycle, scope: GitHubReadScope, health: GitHubApiHealth): void {
  if (scope !== "graphql") {
    lifecycle.githubRestHealth = health;
    return;
  }
  lifecycle.githubGraphqlHealth = health;
  if (health.state === "rate_limited") lifecycle.githubGraphqlBackoffUntil = health.retryAt ?? Date.now() + GRAPHQL_BACKOFF_MS;
}

function recordGitHubReadFailure(
  lifecycle: ServerLifecycle,
  scope: GitHubReadScope,
  error: unknown,
  classifyError: GitHubErrorClassifier,
): never {
  if (lifecycle.isDisposed) throw asGitHubReadError(error);
  recordGitHubReadHealth(lifecycle, scope, classifyError(error, scope));
  throw asGitHubReadError(error);
}

/**
 * Factory-owned GitHub command cache used by both the Changes stack and the
 * authored-PR sidebar. Late commands may resolve, but never mutate a disposed
 * lifecycle or a replacement generation.
 */
export async function readGitHub(
  lifecycle: ServerLifecycle,
  command: GitHubCommand,
  classifyError: GitHubErrorClassifier,
  args: readonly string[],
  maxBuffer: number,
  ttlMs: number,
  identity?: string,
  policy?: GitHubReadPolicy,
): Promise<string> {
  if (lifecycle.isDisposed) throw new Error("GitHub read lifecycle is disposed.");
  const scope = scopeFor(args);
  const key = args.join("\u0000") + (ttlMs === 0 ? "\u0000fresh" : "") + (identity ? `\u0000${identity}` : "");
  const cached = lifecycle.githubReadCache.get(key);
  if (ttlMs > 0 && cached && cached.expiresAt > Date.now()
    && (policy?.afterSequence === undefined || (cached.sequence ?? -Infinity) > policy.afterSequence)) {
    policy?.onValidation?.(cached.validatedAt ?? null, cached.sequence);
    return cached.value;
  }
  const health = scope === "graphql" ? lifecycle.githubGraphqlHealth : lifecycle.githubRestHealth;
  if (health.state === "rate_limited" && health.retryAt && health.retryAt > Date.now()) {
    throw new Error(health.message ?? "GitHub API is rate limited.");
  }
  const pending = lifecycle.githubReadPending.get(key);
  if (pending) {
    if (policy?.afterSequence !== undefined && (pending.sequence ?? -Infinity) <= policy.afterSequence) {
      await pending.catch(() => undefined);
      return readGitHub(lifecycle, command, classifyError, args, maxBuffer, ttlMs, identity, policy);
    }
    const stdout = await pending;
    policy?.onValidation?.(pending.validatedAt ?? null, pending.sequence);
    return stdout;
  }

  const validatedAt = Date.now();
  const sequence = lifecycle.nextObservationSequence();
  const isCurrent = () => !lifecycle.isDisposed && lifecycle.githubReadPending.get(key) === request;
  const request = Object.assign(command(args, maxBuffer)
    .then((stdout) => {
      if (lifecycle.isDisposed) return stdout;
      if (!isCurrent()) throw new Error("GitHub remote data changed during the read.");
      return recordGitHubReadSuccess(lifecycle, scope, key, stdout, ttlMs, validatedAt, sequence);
    })
    .catch((error) => {
      if (lifecycle.isDisposed) throw error;
      if (!isCurrent()) throw new Error("GitHub remote data changed during the read.");
      return recordGitHubReadFailure(lifecycle, scope, error, classifyError);
    })
    .finally(() => {
      if (lifecycle.githubReadPending.get(key) === request)
        lifecycle.releasePending("githubRead", key);
    }), { validatedAt, sequence });
  lifecycle.githubReadPending.set(key, request);
  const stdout = await request;
  policy?.onValidation?.(validatedAt, sequence);
  return stdout;
}
