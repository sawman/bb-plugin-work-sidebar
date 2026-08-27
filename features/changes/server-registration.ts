import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { ChangesCompositionDependencies } from "../../shared/server-composition-dependencies.js";
import {
  createChangesService,
  createWorkingTreeFileDiffReader,
} from "./server.js";

type ChangesHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getChanges"
  | "getChangesFingerprint"
  | "checkoutStackBranch"
  | "getWorkingTreeFileDiff"
>;

function repositoryUnavailable(message: string) {
  return {
    outcome: "unavailable" as const,
    message,
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
  };
}

/** Changes owns repository/file-diff RPC wiring; GitHub state is injected. */
export function createChangesRegistration(
  dependencies: ChangesCompositionDependencies,
): ChangesHandlers {
  const { bb, pullRequests } = dependencies;
  const fileDiff = createWorkingTreeFileDiffReader({
    getThread: async (threadId) => bb.sdk.threads.get({ threadId }),
    diffPatch: ({ environmentId, target, paths }) =>
      bb.sdk.environments.diffPatch({ environmentId, target, paths }),
    diffFiles: ({ environmentId, target }) =>
      bb.sdk.environments.diffFiles({ environmentId, target }),
  });
  const changes = createChangesService({
    repository: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId });
      if (!thread.environmentId) {
        return {
          ...repositoryUnavailable("This thread has no workspace."),
          outcome: "absent" as const,
        };
      }
      try {
        const result = await bb.sdk.environments.status({ environmentId: thread.environmentId });
        if (result.outcome !== "available") {
          return {
            ...repositoryUnavailable("message" in result ? result.message : "Repository status is unavailable."),
            outcome: result.outcome,
          };
        }
        const { workspace } = result;
        const mergeBase = workspace.mergeBase;
        return {
          outcome: "available" as const,
          message: null,
          branch: workspace.branch.currentBranch ?? (
            workspace.checkout.kind === "branch" ? workspace.checkout.branchName : null
          ),
          base: mergeBase?.mergeBaseBranch ?? workspace.branch.defaultBranch,
          ahead: mergeBase?.aheadCount ?? 0,
          behind: mergeBase?.behindCount ?? 0,
          worktreeState: workspace.workingTree.state,
          hasUncommittedChanges: workspace.workingTree.hasUncommittedChanges,
          changedFileCount: workspace.workingTree.files.length,
          changedInsertions: workspace.workingTree.files.reduce(
            (total, file) => total + (file.insertions ?? 0), 0,
          ),
          changedDeletions: workspace.workingTree.files.reduce(
            (total, file) => total + (file.deletions ?? 0), 0,
          ),
          changedFiles: workspace.workingTree.files.slice(0, 8).map((file) => ({
            path: file.path,
            status: file.status,
            insertions: file.insertions,
            deletions: file.deletions,
          })),
        };
      } catch (error) {
        return repositoryUnavailable(
          error instanceof Error ? error.message : "Repository status is unavailable.",
        );
      }
    },
    projection: pullRequests.projection,
    fingerprint: pullRequests.fingerprint,
    checkout: pullRequests.checkout,
    fileDiff,
  });
  return {
    async getChanges({ threadId }) { return changes.get(threadId); },
    async getChangesFingerprint({ threadId, url }) {
      return changes.fingerprint(threadId, url);
    },
    async checkoutStackBranch({ threadId, branch }) {
      return changes.checkout(threadId, branch);
    },
    async getWorkingTreeFileDiff({ threadId, path }) {
      return changes.fileDiff(threadId, path);
    },
  };
}
