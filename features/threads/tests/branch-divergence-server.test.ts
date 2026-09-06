import { describe, expect, it, vi } from "vitest";
import {
  MAX_BRANCH_DIVERGENCE_CONCURRENCY,
  createBranchDivergenceReader,
  resolveRemoteTrackingBranch,
} from "../branch-divergence-server";

const available = (aheadCount: number, behindCount: number) => ({
  outcome: "available" as const,
  workspace: { mergeBase: { aheadCount, behindCount } },
});

describe("thread branch divergence server", () => {
  it("prefers origin, accepts one unique remote, and refuses ambiguity", () => {
    expect(resolveRemoteTrackingBranch("feature/one", ["fork/feature/one", "origin/feature/one"])).toBe("origin/feature/one");
    expect(resolveRemoteTrackingBranch("release", ["upstream/release"])).toBe("upstream/release");
    expect(resolveRemoteTrackingBranch("release", ["fork/release", "upstream/release"])).toBeNull();
    expect(resolveRemoteTrackingBranch("missing", ["origin/main"])).toBeNull();
  });

  it("coalesces environment reads and isolates unsupported or failed rows", async () => {
    const branches = vi.fn(async ({ environmentId }: { environmentId: string }) => ({
      remoteBranches: environmentId === "env_one"
        ? ["fork/feature/one", "origin/feature/one"]
        : environmentId === "env_two"
          ? ["upstream/release"]
          : ["fork/ambiguous", "upstream/ambiguous"],
    }));
    const status = vi.fn(async ({ mergeBaseBranch }: { mergeBaseBranch: string }) => {
      if (mergeBaseBranch !== "origin/feature/one") throw new Error("offline");
      return available(3, 2);
    });
    const read = createBranchDivergenceReader({ diffBranches: branches, status });

    await expect(read([
      { threadId: "thr_one", environmentId: "env_one", branchName: "feature/one" },
      { threadId: "thr_same", environmentId: "env_one", branchName: "feature/one" },
      { threadId: "thr_two", environmentId: "env_two", branchName: "release" },
      { threadId: "thr_three", environmentId: "env_three", branchName: "ambiguous" },
    ])).resolves.toEqual({
      thr_one: { upstream: "origin/feature/one", ahead: 3, behind: 2 },
      thr_same: { upstream: "origin/feature/one", ahead: 3, behind: 2 },
      thr_two: null,
      thr_three: null,
    });
    expect(branches).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(4);
  });

  it("bounds concurrent host environment reads", async () => {
    let active = 0;
    let maximum = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const status = vi.fn(async () => {
      active += 1;
      maximum = Math.max(maximum, active);
      await gate;
      active -= 1;
      return available(1, 0);
    });
    const read = createBranchDivergenceReader({
      diffBranches: vi.fn(async () => ({ remoteBranches: [] })),
      status,
    });
    const pending = read(Array.from(
      { length: MAX_BRANCH_DIVERGENCE_CONCURRENCY + 3 },
      (_, index) => ({
        threadId: `thr_${index}`,
        environmentId: `env_${index}`,
        branchName: `env_${index}`,
      }),
    ));
    await vi.waitFor(() => expect(status).toHaveBeenCalledTimes(MAX_BRANCH_DIVERGENCE_CONCURRENCY));
    release();
    await pending;
    expect(maximum).toBe(MAX_BRANCH_DIVERGENCE_CONCURRENCY);
  });
});
