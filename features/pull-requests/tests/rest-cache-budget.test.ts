import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readGitHub, clearGitHubReadCache } from "../../../shared/github/read-cache";
import { classifyPullRequestError } from "../health";
import { readGitHubSignals } from "../server-stack";
import type { GitHubApiRunner } from "../server-types";
import { factFromPullRequest, mergeNativePullRequestFact, nativeValidationDemands } from "../facts";
import { currentPr } from "../../changes/tests/latency-fixtures";
import { readSignalObservations } from "../signal-validation";
import type { GitHubSignal } from "../server-types";

afterEach(() => vi.useRealTimers());

function fixture(checksWait?: Promise<void>) {
  const lifecycle = createServerLifecycle();
  lifecycle.githubGraphqlBackoffUntil = 10_000_000;
  let metadataHead = "head";
  const command = vi.fn(async (args: readonly string[]) => {
    if (args[1] === "graphql") return JSON.stringify({ data: { repository: { p0: {
      title: "PR", url: currentPr().url, state: "OPEN", isDraft: false, headRefName: "feature", baseRefName: "main", headRefOid: metadataHead, baseRefOid: "base",
      mergeable: "MERGEABLE", mergeStateStatus: "CLEAN", isInMergeQueue: false,
      reviews: { totalCount: 0, nodes: [] }, reviewRequests: { totalCount: 0, nodes: [] }, reviewDecision: "APPROVED", commits: { nodes: [] },
    } } } });
    const target = args.find((arg) => arg.startsWith("repos/"))!;
    if (target.includes("/reviews")) return JSON.stringify(metadataHead === "head" ? [] : [{ user: { login: "reviewer" }, state: "CHANGES_REQUESTED", submitted_at: "2026-10-30T00:00:00Z", commit_id: metadataHead }]);
    if (checksWait && (target.includes("/check-runs") || target.includes("/status?"))) await checksWait;
    if (target.includes("/check-runs")) return JSON.stringify({ total_count: 1, check_runs: [{ status: "completed", conclusion: "success", head_sha: "head" }] });
    if (target.includes("/status?")) return JSON.stringify({ total_count: 0, sha: "head", statuses: [] });
    return JSON.stringify({ title: "PR", state: "open", draft: false, head: { ref: "feature", sha: metadataHead }, base: { ref: "main", sha: "base" }, requested_reviewers: [] });
  });
  const run: GitHubApiRunner = (args, buffer, policy) => readGitHub(lifecycle, command, classifyPullRequestError, args, buffer, 120_000, undefined, policy);
  return { lifecycle, command, run, changeHead: () => { metadataHead = "changed"; } };
}

describe("REST fallback admissions through the production raw cache", () => {
  it("guards freshly refetched reviews when their TTL expires before deferred checks and cached metadata", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    let releaseChecks!: () => void;
    const checksWait = new Promise<void>((resolve) => { releaseChecks = resolve; });
    const { lifecycle, command, run, changeHead } = fixture(checksWait);
    try {
      const firstRead = readGitHubSignals("acme", "repo", [1], lifecycle, run);
      await vi.waitFor(() => expect(command).toHaveBeenCalledTimes(4));
      vi.setSystemTime(110_000);
      releaseChecks();
      expect((await firstRead).get(1)?.checks).toBe("passing");
      expect(command).toHaveBeenCalledTimes(5);
      vi.setSystemTime(225_000);
      changeHead();
      const next = await readGitHubSignals("acme", "repo", [1], lifecycle, run);
      expect(command).toHaveBeenCalledTimes(7); // expired reviews and a new metadata guard
      expect(next.has(1)).toBe(false);
    } finally { lifecycle.dispose(); }
  });

  it("reuses the existing post-checks metadata guard across ordinary polls without renewing evidence", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { lifecycle, command, run } = fixture();
    try {
      const first = (await readGitHubSignals("acme", "repo", [1], lifecycle, run)).get(1)!;
      expect(first.checks).toBe("passing");
      expect(command).toHaveBeenCalledTimes(5);
      for (const now of [130_000, 160_000, 190_000]) {
        vi.setSystemTime(now);
        const cached = (await readGitHubSignals("acme", "repo", [1], lifecycle, run)).get(1)!;
        expect(command).toHaveBeenCalledTimes(5);
        expect(cached.observations?.checks?.validatedAt).toBe(first.observations?.checks?.validatedAt);
        expect(cached.observations?.review?.validatedAt).toBe(first.observations?.review?.validatedAt);
      }
      vi.setSystemTime(220_000);
      const renewed = (await readGitHubSignals("acme", "repo", [1], lifecycle, run)).get(1)!;
      expect(command).toHaveBeenCalledTimes(10);
      expect(renewed.observations?.checks?.validatedAt).toBe(220_000);
      clearGitHubReadCache(lifecycle, "acme/repo");
      await readGitHubSignals("acme", "repo", [1], lifecycle, run);
      expect(command).toHaveBeenCalledTimes(15);
    } finally { lifecycle.dispose(); }
  });

  it.each([30_000, 60_000, 300_000])("bounds unchanged one-PR fallback admissions for one hour at %ims cadence", async (cadence) => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { lifecycle, command, run } = fixture();
    try {
      for (let elapsed = 0; elapsed < 3_600_000; elapsed += cadence) {
        vi.setSystemTime(100_000 + elapsed);
        const result = await readGitHubSignals("acme", "repo", [1], lifecycle, run);
        expect(result.get(1)?.checks).toBe("passing");
      }
      expect(command).toHaveBeenCalledTimes(cadence === 300_000 ? 60 : 150);
    } finally { lifecycle.dispose(); }
  });

  it.each([false, true])("forces a new guard when cached checks postdate metadata and rejects changed-head=%s", async (changed) => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { lifecycle, command, run, changeHead } = fixture();
    try {
      await readGitHubSignals("acme", "repo", [1], lifecycle, run);
      const metadataKey = [...lifecycle.githubReadCache.keys()].find((key) => key.includes("pulls/1\u0000-H"))!;
      const metadata = lifecycle.githubReadCache.get(metadataKey)!;
      lifecycle.githubReadCache.set(metadataKey, { ...metadata, sequence: 0 });
      if (changed) changeHead();
      vi.setSystemTime(130_000);
      const result = await readGitHubSignals("acme", "repo", [1], lifecycle, run);
      expect(command).toHaveBeenCalledTimes(6);
      expect(result.get(1)?.checks).toBe(changed ? undefined : "passing");
    } finally { lifecycle.dispose(); }
  });

  it("retains exact causal proof on replay but pays for all fresh inputs after a new demand", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const { lifecycle, command, run } = fixture();
    const demandFor = (checks: "pending" | "passing", prior?: ReturnType<typeof mergeNativePullRequestFact>) => {
      const fact = factFromPullRequest({ ...currentPr(), signal: { checks, review: "approved", reviewCommentCount: 0 },
        observations: Object.fromEntries(["checks", "review", "mergeability"].map((group) => [group, { source: "native", validatedAt: null }])) });
      return mergeNativePullRequestFact(prior, fact);
    };
    try {
      const firstDirectory = demandFor("passing");
      const demand = nativeValidationDemands(firstDirectory, "acme/repo#1")!;
      const first = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand })).get(1)!;
      expect(first.observations?.checks?.satisfies).toContainEqual(demand.checks);
      expect(first.observations?.review?.satisfies).toContainEqual(demand.review);
      expect(first.observations?.mergeability).toBeUndefined();
      expect(command).toHaveBeenCalledTimes(5);
      vi.setSystemTime(130_000);
      const replay = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: demand })).get(1)!;
      expect(replay.observations?.checks?.satisfies).toContainEqual(demand.checks);
      expect(replay.observations?.mergeability).toBeUndefined();
      expect(command).toHaveBeenCalledTimes(5);
      const changed = nativeValidationDemands(demandFor("pending", firstDirectory), "acme/repo#1")!;
      const next = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: changed })).get(1)!;
      expect(next.observations?.checks?.satisfies).toContainEqual(changed.checks);
      expect(next.observations?.checks?.sequence).toBeGreaterThan(first.observations?.checks?.sequence ?? 0);
      expect(command).toHaveBeenCalledTimes(10);
      expect(next.observations?.mergeability).toBeUndefined();
      vi.setSystemTime(250_001);
      const expired = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: changed })).get(1)!;
      expect(command).toHaveBeenCalledTimes(15);
      expect(expired.observations?.checks?.validatedAt).toBe(250_001);
      clearGitHubReadCache(lifecycle, "acme/repo");
      const manual = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: changed })).get(1)!;
      expect(command).toHaveBeenCalledTimes(20);
      expect(manual.observations?.checks?.satisfies).toContainEqual(changed.checks);
      vi.setSystemTime(10_000_001);
      const restored = (await readGitHubSignals("acme", "repo", [1], lifecycle, run, { 1: changed })).get(1)!;
      expect(command).toHaveBeenCalledTimes(21);
      expect(command.mock.calls.at(-1)?.[0][1]).toBe("graphql");
      expect(restored.observations?.mergeability?.satisfies).toContainEqual(changed.mergeability);
      expect(restored.observations?.mergeability?.epoch).toBe(lifecycle.observationEpoch);
    } finally { lifecycle.dispose(); }
  });

  it.each(["current", "retired-epoch", "missing-head"])("mixed-demand proof admission retains identity guards for %s observations", async (kind) => {
    const lifecycle = createServerLifecycle();
    const checks = { client: "client", occurrence: 2, fingerprint: JSON.stringify(["acme/repo#1", "checks", ["passing"]]) };
    const mergeability = { client: "client", occurrence: 1, fingerprint: JSON.stringify(["acme/repo#1", "mergeability", ["unknown"]]) };
    const load = vi.fn(async (_numbers: number[], bound?: number) => {
      expect(bound).toBeGreaterThan(0);
      return new Map<number, GitHubSignal>([[1, { checks: "passing", review: "none", observations: {
        checks: { source: "github", validatedAt: Date.now(), sequence: lifecycle.nextObservationSequence(),
          epoch: kind === "retired-epoch" ? "retired" : lifecycle.observationEpoch,
          headSha: kind === "missing-head" ? null : "head" },
      } }]]);
    });
    try {
      const signal = (await readSignalObservations({ owner: "acme", repo: "repo", numbers: [1], lifecycle,
        demands: { 1: { checks, mergeability } }, canValidate: (group) => group !== "mergeability", load })).get(1)!;
      expect(load).toHaveBeenCalledOnce();
      expect(signal.observations?.mergeability).toBeUndefined();
      if (kind === "current") {
        expect(signal.observations?.checks?.satisfies).toEqual([checks]);
        expect(signal.observations?.checks?.satisfies).not.toContainEqual({ ...checks, occurrence: 1 });
      } else expect(signal.observations?.checks?.satisfies).toBeUndefined();
    } finally { lifecycle.dispose(); }
  });
});
