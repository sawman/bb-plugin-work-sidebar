import { describe, expect, it, vi } from "vitest";
import type { ChangesCompositionDependencies } from "../../../shared/server-composition-dependencies";
import { createChangesRegistration } from "../server-registration";

describe("Changes server registration", () => {
  it("returns every working-tree file instead of truncating the repository payload", async () => {
    const files = Array.from({ length: 12 }, (_, index) => ({
      path: `src/file-${index + 1}.ts`,
      status: "modified",
      insertions: index + 1,
      deletions: index,
    }));
    const registration = createChangesRegistration({
      bb: {
        sdk: {
          threads: {
            get: vi.fn(async () => ({ environmentId: "env_changes" })),
          },
          environments: {
            status: vi.fn(async () => ({
              outcome: "available",
              workspace: {
                branch: {
                  currentBranch: "feature/all-files",
                  defaultBranch: "main",
                },
                checkout: { kind: "branch", branchName: "feature/all-files" },
                mergeBase: null,
                workingTree: {
                  state: "dirty_uncommitted",
                  hasUncommittedChanges: true,
                  files,
                },
              },
            })),
            diffPatch: vi.fn(),
            diffFiles: vi.fn(),
          },
        },
      },
      pullRequests: {
        projection: vi.fn(async () => ({
          currentPullRequest: null,
          stack: null,
          stackUnavailableReason: null,
          githubStack: null,
        })),
        fingerprint: vi.fn(),
        checkout: vi.fn(),
      },
    } as unknown as ChangesCompositionDependencies);

    const result = await registration.getChanges({ threadId: "thr_changes" });

    expect(result.repository.changedFileCount).toBe(12);
    expect(result.repository.changedFiles).toHaveLength(12);
    expect(result.repository.changedFiles.at(-1)?.path).toBe("src/file-12.ts");
  });
});
