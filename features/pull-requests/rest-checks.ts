import type { GitHubApiRunner, CurrentPullRequest } from "./server-types.js";
import { readObservedGitHub } from "./source-observation.js";

export const MAX_REST_CHECK_PAGES = 10;
type Source = Awaited<ReturnType<typeof readObservedGitHub>>;
function record(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }

/** SHA-scoped, bounded pages; missing/truncated/error responses cannot pass. */
export async function readRestChecks(input: {
  owner: string; repo: string; sha: string; run: GitHubApiRunner; headers: string[]; afterSequence?: number;
}) {
  const sources: Source[] = [];
  async function pages(kind: "check-runs" | "status") {
    const entries: unknown[] = [];
    let expected: number | undefined;
    for (let page = 1; page <= MAX_REST_CHECK_PAGES; page++) {
      const source = await readObservedGitHub(input.run, ["api", "--method", "GET",
        `repos/${input.owner}/${input.repo}/commits/${input.sha}/${kind}?per_page=100${page === 1 ? "" : `&page=${page}`}`,
        ...input.headers], 4_000_000, input.afterSequence);
      sources.push(source);
      const body = JSON.parse(source.text) as unknown;
      if (!record(body) || !Number.isInteger(body.total_count) || Number(body.total_count) < 0)
        throw new Error("Incomplete GitHub checks response.");
      const collection = kind === "check-runs" ? body.check_runs : body.statuses;
      if (!Array.isArray(collection)) throw new Error("Incomplete GitHub checks page.");
      if (expected !== undefined && expected !== body.total_count) throw new Error("GitHub checks changed during pagination.");
      expected = Number(body.total_count);
      if (kind === "status" && body.sha !== input.sha) throw new Error("GitHub status head changed.");
      if (kind === "check-runs" && collection.some((entry) => !record(entry) || entry.head_sha !== input.sha))
        throw new Error("GitHub check-run head changed.");
      entries.push(...collection);
      if (entries.length === expected) return entries;
      if (entries.length > expected || collection.length < 100) throw new Error("Incomplete GitHub checks page.");
    }
    throw new Error("GitHub checks exceed the page limit.");
  }
  const [runs, statuses] = await Promise.all([pages("check-runs"), pages("status")]);
  let failedCount = 0; let pendingCount = 0; let passedCount = 0; let unknownCount = 0;
  for (const run of runs) {
    if (!record(run)) { unknownCount++; continue; }
    const status = String(run.status ?? "").toLowerCase();
    const conclusion = String(run.conclusion ?? "").toLowerCase();
    if (["queued", "in_progress", "waiting", "requested", "pending"].includes(status) || conclusion === "stale") pendingCount++;
    else if (status !== "completed") unknownCount++;
    else if (["failure", "timed_out", "cancelled", "action_required", "startup_failure"].includes(conclusion)) failedCount++;
    else if (["success", "neutral", "skipped"].includes(conclusion)) passedCount++;
    else unknownCount++;
  }
  for (const status of statuses) {
    const state = record(status) ? String(status.state ?? "").toLowerCase() : "";
    if (state === "failure" || state === "error") failedCount++;
    else if (state === "pending") pendingCount++;
    else if (state === "success") passedCount++;
    else unknownCount++;
  }
  const totalCount = runs.length + statuses.length;
  const checks: CurrentPullRequest["checks"] = { failedCount, pendingCount, passedCount, totalCount,
    state: failedCount ? "failing" : pendingCount ? "pending" : unknownCount ? "unknown" : totalCount ? "passing" : "no_checks" };
  return { checks, sources };
}

export function earliestValidation(sources: Source[]) {
  return {
    validatedAt: sources.some((source) => source.validatedAt === null) ? null : Math.min(...sources.map((source) => source.validatedAt!)),
    sequence: sources.some((source) => source.sequence === undefined) ? undefined : Math.min(...sources.map((source) => source.sequence!)),
  };
}
