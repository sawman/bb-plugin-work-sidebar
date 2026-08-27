import { describe, expect, it, vi } from "vitest";
import { createChangesService, createWorkingTreeFileDiffReader, type WorkingTreeFileDiffReaderDependencies } from "../server";

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

describe("R14 working-tree file diff reader", () => {
  it("classifies no environment, patches, binary files, absent patches, SDK unavailability, and thrown SDK errors", async () => {
    const getThread = vi.fn<WorkingTreeFileDiffReaderDependencies["getThread"]>(async () => ({ environmentId: "env_one" }));
    const diffPatch = vi.fn<WorkingTreeFileDiffReaderDependencies["diffPatch"]>(async () => ({
      outcome: "available" as const,
      patches: [{ path: "src/file.ts", patch: "@@ -1 +1 @@\n-old\n+new", truncated: false }],
    }));
    const diffFiles = vi.fn<WorkingTreeFileDiffReaderDependencies["diffFiles"]>(async () => ({
      outcome: "available" as const,
      files: [],
      initialPatches: [],
      mergeBaseRef: null,
      shortstat: "",
      truncated: false,
    }));
    const reader = createWorkingTreeFileDiffReader({ getThread, diffPatch, diffFiles });

    await expect(reader("thr_one", "src/file.ts")).resolves.toEqual({
      kind: "patch",
      path: "src/file.ts",
      patch: "@@ -1 +1 @@\n-old\n+new",
      message: null,
    });
    expect(getThread).toHaveBeenCalledWith("thr_one");
    expect(diffPatch).toHaveBeenCalledWith({ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["src/file.ts"] });
    expect(diffFiles).toHaveBeenCalledWith({ environmentId: "env_one", target: "uncommitted" });

    getThread.mockResolvedValueOnce({ environmentId: null });
    await expect(reader("thr_none", "none.ts")).resolves.toMatchObject({ kind: "unavailable", path: "none.ts", message: "This thread has no workspace." });

    diffFiles.mockResolvedValueOnce({ outcome: "available", files: [{ path: "image.png", binary: true }] });
    await expect(reader("thr_binary", "image.png")).resolves.toMatchObject({ kind: "binary", path: "image.png" });

    diffPatch.mockResolvedValueOnce({ outcome: "available", patches: [] });
    await expect(reader("thr_absent", "gone.ts")).resolves.toMatchObject({ kind: "absent", path: "gone.ts" });

    diffPatch.mockResolvedValueOnce({ outcome: "unavailable", failure: { message: "SDK unavailable" } });
    await expect(reader("thr_sdk", "offline.ts")).resolves.toMatchObject({ kind: "unavailable", path: "offline.ts", message: "SDK unavailable" });

    diffPatch.mockRejectedValueOnce(new Error("SDK threw"));
    await expect(reader("thr_throw", "throw.ts")).resolves.toMatchObject({ kind: "unavailable", path: "throw.ts", message: "SDK threw" });

    expect(getThread.mock.calls).toEqual([["thr_one"], ["thr_none"], ["thr_binary"], ["thr_absent"], ["thr_sdk"], ["thr_throw"]]);
    expect(diffPatch.mock.calls).toEqual([
      [{ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["src/file.ts"] }],
      [{ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["image.png"] }],
      [{ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["gone.ts"] }],
      [{ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["offline.ts"] }],
      [{ environmentId: "env_one", target: { type: "uncommitted" }, paths: ["throw.ts"] }],
    ]);
    expect(diffFiles.mock.calls).toEqual([
      [{ environmentId: "env_one", target: "uncommitted" }],
      [{ environmentId: "env_one", target: "uncommitted" }],
      [{ environmentId: "env_one", target: "uncommitted" }],
      [{ environmentId: "env_one", target: "uncommitted" }],
      [{ environmentId: "env_one", target: "uncommitted" }],
    ]);
  });
});
