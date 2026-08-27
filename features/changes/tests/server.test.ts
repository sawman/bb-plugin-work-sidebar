import { describe, expect, it, vi } from "vitest";
import { createChangesService } from "../server";

describe("R13 Changes server adapter", () => {
  it("reads repository and stack projection for only the requested thread, including unavailable state", async () => {
    const repository = vi.fn(async () => ({ outcome: "unavailable" as const, message: "offline", branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] }));
    const projection = vi.fn(async () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null }));
    const service = createChangesService({ repository, projection, fingerprint: vi.fn(async () => ({ fingerprint: null })) });
    await expect(service.get("thr_one")).resolves.toMatchObject({ repository: { outcome: "unavailable" } });
    expect(repository).toHaveBeenCalledExactlyOnceWith("thr_one"); expect(projection).toHaveBeenCalledExactlyOnceWith("thr_one");
  });
});
