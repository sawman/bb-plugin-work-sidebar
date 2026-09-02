import type { Changes, CheckoutStackBranchResult, Repository, WorkingTreeFileDiff } from "./schemas.js";

export type ChangesServiceDependencies = {
  repository(threadId: string): Promise<Repository>;
  projection(threadId: string): Promise<Omit<Changes, "repository">>;
  fingerprint(threadId: string, url: string): Promise<{ fingerprint: string | null }>;
  checkout(threadId: string, branch: string): Promise<CheckoutStackBranchResult>;
  fileDiff(threadId: string, path: string): Promise<WorkingTreeFileDiff>;
  pullRequestFileDiff(
    threadId: string,
    pullRequestNumber: number,
    path: string,
  ): Promise<WorkingTreeFileDiff>;
};

type WorkingTreePatchResult =
  | { outcome: "available"; patches: Array<{ path: string; patch: string }> }
  | { outcome: "not_applicable"; message: string }
  | { outcome: "unavailable"; failure: { message: string } };

type WorkingTreeFilesResult =
  | { outcome: "available"; files: Array<{ path: string; binary: boolean }> }
  | { outcome: "not_applicable"; message: string }
  | { outcome: "unavailable"; failure: { message: string } };

export type WorkingTreeFileDiffReaderDependencies = {
  getThread(threadId: string): Promise<{ environmentId: string | null | undefined }>;
  diffPatch(input: { environmentId: string; target: { type: "uncommitted" }; paths: string[] }): Promise<WorkingTreePatchResult>;
  diffFiles(input: { environmentId: string; target: "uncommitted" }): Promise<WorkingTreeFilesResult>;
};

/** Classifies the host workspace diff APIs for the Changes RPC contract. */
export function createWorkingTreeFileDiffReader(dependencies: WorkingTreeFileDiffReaderDependencies) {
  return async (threadId: string, path: string): Promise<WorkingTreeFileDiff> => {
    try {
      const thread = await dependencies.getThread(threadId);
      if (!thread.environmentId)
        return { kind: "unavailable", path, patch: null, message: "This thread has no workspace." };
      const [patchResult, filesResult] = await Promise.all([
        dependencies.diffPatch({ environmentId: thread.environmentId, target: { type: "uncommitted" }, paths: [path] }),
        dependencies.diffFiles({ environmentId: thread.environmentId, target: "uncommitted" }),
      ]);
      if (patchResult.outcome !== "available")
        return { kind: "unavailable", path, patch: null, message: "message" in patchResult ? patchResult.message : patchResult.failure.message };
      if (filesResult.outcome === "available" && filesResult.files.find((file) => file.path === path)?.binary)
        return { kind: "binary", path, patch: null, message: "This binary file cannot be shown as a text diff." };
      const patch = patchResult.patches.find((entry) => entry.path === path)?.patch ?? null;
      return patch
        ? { kind: "patch", path, patch, message: null }
        : { kind: "absent", path, patch: null, message: "No diff is available for this file." };
    } catch (error) {
      return { kind: "unavailable", path, patch: null, message: error instanceof Error ? error.message : "Could not load the file diff." };
    }
  };
}

/** Thread-specific adapter: repository state and PR stack are one Changes projection. */
export function createChangesService(dependencies: ChangesServiceDependencies) {
  return {
    async get(threadId: string): Promise<Changes> {
      const [repository, projection] = await Promise.all([dependencies.repository(threadId), dependencies.projection(threadId)]);
      return { ...projection, repository };
    },
    fingerprint(threadId: string, url: string) { return dependencies.fingerprint(threadId, url); },
    checkout(threadId: string, branch: string) { return dependencies.checkout(threadId, branch); },
    fileDiff(threadId: string, path: string) { return dependencies.fileDiff(threadId, path); },
    pullRequestFileDiff(threadId: string, pullRequestNumber: number, path: string) {
      return dependencies.pullRequestFileDiff(threadId, pullRequestNumber, path);
    },
  };
}
