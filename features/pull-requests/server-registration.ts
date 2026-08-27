import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import type { PullRequestChangesAdapter } from "../../shared/server-composition-dependencies.js";
import { createAuthoredPullRequestService } from "./server-authored.js";
import { createGitHubCommandService } from "./server-github-read.js";
import { createGitHubPollingService } from "./server-polling.js";
import { createThreadStackService } from "./server-thread-stack.js";

type PullRequestHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getGitHubPollingPolicy"
  | "getGitHubApiHealth"
  | "sidebarPullRequestStacks"
  | "sidebarThreadPullRequests"
  | "sidebarAuthoredPullRequests"
  | "sidebarAuthoredPullRequestStacks"
  | "setAuthoredPullRequestDraft"
>;

export type PullRequestRegistration = PullRequestHandlers & PullRequestChangesAdapter;

/** PR slice composition: domain services retain their own command and lifecycle ownership. */
export function createPullRequestRegistration(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
): PullRequestRegistration {
  const commands = createGitHubCommandService(lifecycle);
  const polling = createGitHubPollingService(bb, commands.read);
  const authored = createAuthoredPullRequestService(bb, lifecycle, commands);
  const threadStack = createThreadStackService(bb, lifecycle, commands.read);
  const registration: PullRequestRegistration = { ...polling, ...authored, ...threadStack };
  return registration;
}

export { fetchGitHubStack } from "./server-stack.js";
