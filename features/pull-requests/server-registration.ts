import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { PullRequestChangesAdapter } from "../../shared/server-composition-dependencies.js";
import { createAuthoredPullRequestService } from "./server-authored.js";
import { createGitHubCommandService, type GitHubCommandService } from "./server-github-read.js";
import { createGitHubPollingService } from "./server-polling.js";
import { createRepositoryTopologyReader } from "./remote-topology-server.js";
import { createRemoteFilesService } from "./remote-files-server.js";
import { clearGitHubReadCache } from "../../shared/github/read-cache.js";
import { createThreadStackService } from "./server-thread-stack.js";

type PullRequestHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getGitHubPollingPolicy"
  | "getGitHubApiHealth"
  | "sidebarThreadPullRequests"
  | "sidebarAuthoredPullRequests"
  | "sidebarAuthoredPullRequestStacks"
  | "setAuthoredPullRequestDraft"
  | "getPullRequestReviewers"
  | "updatePullRequestReviewers"
>;

export type PullRequestRegistration = PullRequestHandlers & PullRequestChangesAdapter;

/** PR slice composition: domain services retain their own command and lifecycle ownership. */
export function createPullRequestRegistration(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
  commands: GitHubCommandService = createGitHubCommandService(lifecycle),
): PullRequestRegistration {
  const topology = createRepositoryTopologyReader(lifecycle, commands.read);
  const authored = createAuthoredPullRequestService(bb, lifecycle, commands, topology);
  const polling = createGitHubPollingService(bb, commands.read);
  const remoteFiles = createRemoteFilesService(lifecycle, commands.read);
  const threadStack = createThreadStackService(bb, lifecycle, commands.read, remoteFiles.files, topology);
  const registration: PullRequestRegistration = { ...polling, ...authored, ...threadStack,
    remoteFiles: remoteFiles.files,
    invalidateRemote(repository) {
      clearGitHubReadCache(lifecycle, repository);
      remoteFiles.invalidate(repository);
      threadStack.invalidateRemote(repository);
      return { ok: true };
    },
  };
  return registration;
}

export { fetchGitHubStack } from "./server-stack.js";
