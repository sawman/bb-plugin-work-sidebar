// Browser-safe classification shared by GitHub reads and their error presentation.
export type PullRequestHealth = { state: "available" | "rate_limited" | "unavailable"; scope: "graphql" | "rest" | "unknown"; message: string | null; retryAt: number | null };

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
