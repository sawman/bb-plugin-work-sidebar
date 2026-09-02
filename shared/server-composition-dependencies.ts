import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../contracts.js";
import type { ServerLifecycle } from "../server-lifecycle.js";
import type { PullRequestRegistration } from "../features/pull-requests/server-registration.js";
import type { TasksRegistration } from "../features/tasks/server-registration.js";

/** Typed cross-slice seam; entrypoint composition supplies real host services. */
export type ServerCompositionDependencies = {
  bb: BbPluginApi;
  lifecycle: ServerLifecycle;
  pullRequests: PullRequestRegistration;
  tasks: TasksRegistration;
};

export type ChangesCompositionDependencies = Pick<
  ServerCompositionDependencies,
  "bb" | "pullRequests"
>;
export type WorkContextCompositionDependencies = Pick<
  ServerCompositionDependencies,
  "bb" | "tasks"
>;
export type TrackerCompositionDependencies = Pick<
  ServerCompositionDependencies,
  "bb" | "tasks"
>;

/** Changes consumes this PR-only adapter without importing its implementation. */
export type PullRequestChangesAdapter = {
  projection(threadId: string): Promise<Omit<
    Awaited<ReturnType<PluginRpcHandlers<typeof rpcContract>["getChanges"]>>,
    "repository"
  >>;
  fingerprint(threadId: string, url: string): Promise<Awaited<
    ReturnType<PluginRpcHandlers<typeof rpcContract>["getChangesFingerprint"]>
  >>;
  checkout(threadId: string, branch: string): Promise<Awaited<
    ReturnType<PluginRpcHandlers<typeof rpcContract>["checkoutStackBranch"]>
  >>;
  fileDiff(threadId: string, pullRequestNumber: number, path: string): Promise<Awaited<
    ReturnType<PluginRpcHandlers<typeof rpcContract>["getPullRequestFileDiff"]>
  >>;
};
