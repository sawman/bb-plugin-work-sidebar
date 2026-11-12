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
    expectedHead?: import("./schemas.js").RemoteFileHead,
  ): Promise<WorkingTreeFileDiff>;
};

type WorkingTreePatchResult =
  | { outcome: "available"; patch: { path: string; patch: string; truncated: boolean } }
  | { outcome: "not_applicable"; message: string }
  | { outcome: "unavailable"; failure: { message: string } };

type WorkingTreeFilesResult =
  | { outcome: "available"; files: Array<{ path: string; binary: boolean; revision: string }>; initialPatches: Array<{ path: string; patch: string; truncated: boolean }>; truncated: boolean }
  | { outcome: "not_applicable"; message: string }
  | { outcome: "unavailable"; failure: { message: string } };

export type WorkingTreeFileDiffReaderDependencies = {
  getThread(threadId: string): Promise<{ environmentId: string | null | undefined }>;
  diffPatch(input: { environmentId: string; path: string; revision: string }): Promise<WorkingTreePatchResult>;
  diffFiles(input: { environmentId: string; target: "uncommitted" }): Promise<WorkingTreeFilesResult>;
};

/** Classifies the host workspace diff APIs for the Changes RPC contract. */
export function createWorkingTreeFileDiffReader(dependencies: WorkingTreeFileDiffReaderDependencies) {
  return async (threadId: string, path: string): Promise<WorkingTreeFileDiff> => {
    try {
      const thread = await dependencies.getThread(threadId);
      if (!thread.environmentId)
        return { kind: "unavailable", path, patch: null, message: "This thread has no workspace." };
      const filesResult = await dependencies.diffFiles({ environmentId: thread.environmentId, target: "uncommitted" });
      if (filesResult.outcome !== "available")
        return { kind: "unavailable", path, patch: null, message: "message" in filesResult ? filesResult.message : filesResult.failure.message };
      const file = filesResult.files.find((entry) => entry.path === path);
      if (!file)
        return { kind: filesResult.truncated ? "unavailable" : "absent", path, patch: null, message: "No diff is available for this file." };
      if (file.binary)
        return { kind: "binary", path, patch: null, message: "This binary file cannot be shown as a text diff." };
      const initialPatch = filesResult.initialPatches.find((entry) => entry.path === path);
      const patchResult = initialPatch
        ? { outcome: "available" as const, patch: initialPatch }
        : await dependencies.diffPatch({ environmentId: thread.environmentId, path, revision: file.revision });
      if (patchResult.outcome !== "available")
        return { kind: "unavailable", path, patch: null, message: "message" in patchResult ? patchResult.message : patchResult.failure.message };
      if (patchResult.patch.truncated)
        return { kind: "unavailable", path, patch: null, message: "This file's diff is incomplete because it exceeds the host limit." };
      const patch = patchResult.patch.patch;
      return patch
        ? { kind: "patch", path, patch, message: null }
        : { kind: "absent", path, patch: null, message: "No diff is available for this file." };
    } catch (error) {
      return { kind: "unavailable", path, patch: null, message: error instanceof Error ? error.message : "Could not load the file diff." };
    }
  };
}

/** Independent stage readers; the aggregate remains a thin RPC compatibility adapter. */
export function createChangesService(dependencies: ChangesServiceDependencies) {
  return {
    repository: dependencies.repository,
    projection: dependencies.projection,
    async get(threadId: string): Promise<Changes> {
      const [repository, projection] = await Promise.all([dependencies.repository(threadId), dependencies.projection(threadId)]);
      return { ...projection, repository };
    },
    fingerprint(threadId: string, url: string) { return dependencies.fingerprint(threadId, url); },
    checkout(threadId: string, branch: string) { return dependencies.checkout(threadId, branch); },
    fileDiff(threadId: string, path: string) { return dependencies.fileDiff(threadId, path); },
    pullRequestFileDiff(threadId: string, pullRequestNumber: number, path: string, expectedHead?: import("./schemas.js").RemoteFileHead) {
      return expectedHead
        ? dependencies.pullRequestFileDiff(threadId, pullRequestNumber, path, expectedHead)
        : dependencies.pullRequestFileDiff(threadId, pullRequestNumber, path);
    },
  };
}
