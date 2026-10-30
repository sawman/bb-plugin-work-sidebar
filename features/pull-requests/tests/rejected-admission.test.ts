import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerLifecycle } from "../../../server-lifecycle";
import { readSignalObservations, type PendingSignalValidation } from "../signal-validation";
import type { GitHubSignal } from "../server-types";

describe("per-PR rejected admission ownership", () => {
  afterEach(() => vi.useRealTimers());
  it.each(["scope", "pending-cap", "client-cap"])("settles independent valid work and releases its reservation after a later %s rejection", async (failure) => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const lifecycle = createServerLifecycle();
    const demand = { client: "new-client", occurrence: 1, fingerprint: JSON.stringify([`acme/repo#${failure === "scope" ? 9 : 8}`, "checks", ["passing"]]) };
    if (failure === "pending-cap") {
      for (let index = 0; index < 299; index++) lifecycle.githubPullRequestSignalPending.set(`other/repo#${index}`, Promise.resolve(null));
    }
    if (failure === "client-cap") {
      const existing: PendingSignalValidation = new Promise(() => {});
      existing.receipts = Array.from({ length: 32 }, (_, index) => ({ group: "checks", sequence: index + 1,
        demand: { ...demand, client: `existing-${index}` } }));
      lifecycle.githubPullRequestSignalPending.set("acme/repo#8", existing);
    }
    const retained = lifecycle.githubPullRequestSignalPending.size;
    const load = vi.fn(async (numbers: number[]) => new Map(numbers.map((number): [number, GitHubSignal] => [number, {
      checks: "passing", review: "approved", observations: {
        checks: { source: "github", validatedAt: 100_000, headSha: "head", baseSha: "base", sequence: lifecycle.nextObservationSequence(), epoch: lifecycle.observationEpoch },
      },
    }])));
    try {
      const result = await readSignalObservations({ owner: "acme", repo: "repo", numbers: [7, 8], lifecycle,
        demands: { 8: { checks: demand } }, load });
      expect([...result.keys()]).toEqual([7]);
      expect(load).toHaveBeenCalledOnce();
      expect(load.mock.calls[0]?.[0]).toEqual([7]);
      expect(lifecycle.githubPullRequestSignalPending.has("acme/repo#7")).toBe(false);
      expect(lifecycle.githubPullRequestSignalPending.size).toBe(retained);
      const followup = await readSignalObservations({ owner: "acme", repo: "repo", numbers: [7], lifecycle, demands: {}, load });
      expect(followup.get(7)?.checks).toBe("passing");
      expect(load).toHaveBeenCalledOnce();
      expect(result.get(8)?.observations?.checks?.satisfies).toBeUndefined();
    } finally { lifecycle.dispose(); }
  });
});
