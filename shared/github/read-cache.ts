import type { GitHubApiHealth, ServerLifecycle } from "../../server-lifecycle.js";

export type GitHubReadScope = "graphql" | "rest";
export type GitHubCommand = (args: readonly string[], maxBuffer: number) => Promise<string>;
export type GitHubErrorClassifier = (error: unknown, scope: GitHubReadScope) => GitHubApiHealth;

const GRAPHQL_BACKOFF_MS = 60 * 60_000;

function scopeFor(args: readonly string[]): GitHubReadScope {
  return args[0] === "api" && args[1] === "graphql" ? "graphql" : "rest";
}

export function githubReadHealth(lifecycle: ServerLifecycle): GitHubApiHealth {
  if (lifecycle.githubGraphqlHealth.state !== "available") return lifecycle.githubGraphqlHealth;
  if (lifecycle.githubRestHealth.state !== "available") return lifecycle.githubRestHealth;
  return { state: "available", scope: "unknown", message: null, retryAt: null };
}

export function clearGitHubReadCache(lifecycle: ServerLifecycle): void {
  lifecycle.githubReadCache.clear();
  lifecycle.githubPullRequestSignalCache.clear();
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
): Promise<string> {
  const scope = scopeFor(args);
  const health = scope === "graphql" ? lifecycle.githubGraphqlHealth : lifecycle.githubRestHealth;
  if (health.state === "rate_limited" && health.retryAt && health.retryAt > Date.now()) {
    throw new Error(health.message ?? "GitHub API is rate limited.");
  }
  const key = args.join("\u0000");
  const cached = lifecycle.githubReadCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  const pending = lifecycle.githubReadPending.get(key);
  if (pending) return pending;

  const request = command(args, maxBuffer).then((stdout) => {
    if (lifecycle.isDisposed) return stdout;
    if (scope === "graphql") lifecycle.githubGraphqlHealth = { state: "available", scope, message: null, retryAt: null };
    else lifecycle.githubRestHealth = { state: "available", scope, message: null, retryAt: null };
    if (lifecycle.githubReadCache.size >= 300) lifecycle.githubReadCache.delete(lifecycle.githubReadCache.keys().next().value!);
    lifecycle.cacheGitHubRead(key, stdout, Date.now() + ttlMs);
    return stdout;
  }).catch((error) => {
    if (!lifecycle.isDisposed) {
      const classified = classifyError(error, scope);
      if (scope === "graphql") {
        lifecycle.githubGraphqlHealth = classified;
        if (classified.state === "rate_limited") lifecycle.githubGraphqlBackoffUntil = classified.retryAt ?? Date.now() + GRAPHQL_BACKOFF_MS;
      } else lifecycle.githubRestHealth = classified;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }).finally(() => lifecycle.releasePending("githubRead", key));
  lifecycle.githubReadPending.set(key, request);
  return request;
}
