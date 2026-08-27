import { describe, expect, it, vi } from "vitest";
import { createChangesService } from "../server";

describe("R13 Changes server adapter", () => {
  it("reads repository and stack projection for only the requested thread, including unavailable state", async () => {
    const repository = vi.fn(async () => ({
      outcome: "unavailable" as const,
      message: "offline",
      branch: null,
      base: null,
      ahead: 0,
      behind: 0,
      worktreeState: null,
      hasUncommittedChanges: false,
      changedFileCount: 0,
      changedInsertions: 0,
      changedDeletions: 0,
      changedFiles: [],
    }));
    const projection = vi.fn(async () => ({
      currentPullRequest: null,
      stack: null,
      stackUnavailableReason: null,
      githubStack: null,
    }));
    const service = createChangesService({
      repository,
      projection,
      fingerprint: vi.fn(async () => ({ fingerprint: null })),
    });
    await expect(service.get("thr_one")).resolves.toMatchObject({
      repository: { outcome: "unavailable" },
    });
    expect(repository).toHaveBeenCalledExactlyOnceWith("thr_one");
    expect(projection).toHaveBeenCalledExactlyOnceWith("thr_one");
  });
  it("preserves stack and non-stack projections and forwards the fingerprint thread/url unchanged", async () => {
    const fingerprint = vi.fn(async () => ({ fingerprint: "next" }));
    const service = createChangesService({
      repository: async () => ({
        outcome: "available",
        message: null,
        branch: "main",
        base: "main",
        ahead: 0,
        behind: 0,
        worktreeState: "clean",
        hasUncommittedChanges: false,
        changedFileCount: 0,
        changedInsertions: 0,
        changedDeletions: 0,
        changedFiles: [],
      }),
      projection: async (threadId) => ({
        currentPullRequest: null,
        stack:
          threadId === "thr_stack"
            ? {
                number: 1,
                base: "main",
                currentPullRequest: 1,
                pullRequests: [],
              }
            : null,
        stackUnavailableReason: null,
        githubStack: null,
      }),
      fingerprint,
    });
    expect((await service.get("thr_stack")).stack).not.toBeNull();
    expect((await service.get("thr_single")).stack).toBeNull();
    await expect(
      service.fingerprint("thr_single", "https://github.com/acme/repo/pull/1"),
    ).resolves.toEqual({ fingerprint: "next" });
    expect(fingerprint).toHaveBeenCalledWith(
      "thr_single",
      "https://github.com/acme/repo/pull/1",
    );
  });
});
