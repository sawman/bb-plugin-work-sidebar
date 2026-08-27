import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rpcContract } from "../../contracts.js";
import { createPluginRpcCaller, type PluginRpcInput } from "../../shared/server-plugin-rpc.js";
import type { TrackerCompositionDependencies } from "../../shared/server-composition-dependencies.js";
import { createTrackerService, TRACKER_LINKS_KEY } from "./server.js";

type TrackerHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getWorkTracker"
  | "linkLinearIssue"
  | "searchLinearIssues"
  | "unlinkLinearIssue"
  | "updateLinearIssueStatus"
>;

export type WorkRootResolver = (threadId: string) => Promise<{ id: string; projectId: string }>;

/** Taskboard adapter and its RPC handlers are owned by the Tracker slice. */
export function createTrackerRegistration(
  dependencies: TrackerCompositionDependencies,
): TrackerHandlers {
  const { bb, tasks } = dependencies;
  const callPluginRpc = createPluginRpcCaller(bb);
  const tracker = createTrackerService({
    call: <T>(method: string, input: PluginRpcInput, outputSchema: z.ZodType<T>) =>
      callPluginRpc("taskboard", method, input, outputSchema),
    getStorage: () => bb.storage.kv.get<unknown>(TRACKER_LINKS_KEY),
    setStorage: (value) => bb.storage.kv.set(TRACKER_LINKS_KEY, value),
    rootThread: tasks.rootThread,
    threadTitle: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread.title ?? thread.titleFallback ?? "";
    },
    publish: (threadId) => bb.realtime.publish("work-sidebar:changed", { threadId }),
  });
  return {
    async getWorkTracker({ threadId }) { return tracker.context(threadId); },
    async linkLinearIssue({ threadId, key }) { return tracker.link(threadId, key); },
    async searchLinearIssues({ threadId, query }) {
      return tracker.search(threadId, query);
    },
    async unlinkLinearIssue({ threadId }) { return tracker.unlink(threadId); },
    async updateLinearIssueStatus({ threadId, statusId }) {
      return tracker.updateStatus(threadId, statusId);
    },
  };
}
