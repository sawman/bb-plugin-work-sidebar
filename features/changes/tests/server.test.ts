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
      checkout: vi.fn(async () => ({ ok: true, message: "Checked out", detail: null })),
      fileDiff: vi.fn(async (_threadId, path) => ({ kind: "absent" as const, path, patch: null, message: "No diff" })),
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
      checkout: vi.fn(async () => ({ ok: true, message: "Checked out", detail: null })),
      fileDiff: vi.fn(async (_threadId, path) => ({ kind: "absent" as const, path, patch: null, message: "No diff" })),
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
  it("forwards checkout and one lazy file-diff read through the injected thread service", async () => {
    const checkout = vi.fn(async () => ({ ok: false, message: "Blocked", tone: "warning" as const, detail: null }));
    const fileDiff = vi.fn(async (_threadId: string, path: string) => ({ kind: "binary" as const, path, patch: null, message: "Binary" }));
    const service = createChangesService({
      repository: async () => ({ outcome: "available", message: null, branch: "main", base: "main", ahead: 0, behind: 0, worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] }),
      projection: async () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null }),
      fingerprint: async () => ({ fingerprint: null }),
      checkout,
      fileDiff,
    });
    await expect(service.checkout("thr_one", "feature/one")).resolves.toMatchObject({ ok: false, message: "Blocked" });
    await expect(service.fileDiff("thr_one", "image.png")).resolves.toMatchObject({ kind: "binary", path: "image.png" });
    expect(checkout).toHaveBeenCalledOnce();
    expect(checkout).toHaveBeenCalledWith("thr_one", "feature/one");
    expect(fileDiff).toHaveBeenCalledOnce();
    expect(fileDiff).toHaveBeenCalledWith("thr_one", "image.png");
  });
});
