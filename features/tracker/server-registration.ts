import type { PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { z } from "zod";
import { rpcContract } from "../../contracts.js";
import {
  createPluginRpcCaller,
  type PluginRpcInput,
} from "../../shared/server-plugin-rpc.js";
import type { TrackerCompositionDependencies } from "../../shared/server-composition-dependencies.js";
import { createSqliteTrackerLinkStore, createTrackerService } from "./server.js";

type TrackerHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getWorkTracker"
  | "linkLinearIssue"
  | "searchLinearIssues"
  | "unlinkLinearIssue"
  | "setPrimaryLinearIssue"
  | "updateLinearIssueStatus"
>;

export type WorkRootResolver = (
  threadId: string,
) => Promise<{ id: string; projectId: string }>;

/** Taskboard adapter and its RPC handlers are owned by the Tracker slice. */
export function createTrackerRegistration(
  dependencies: TrackerCompositionDependencies,
): TrackerHandlers {
  const { bb, tasks } = dependencies;
  const callPluginRpc = createPluginRpcCaller(bb);
  const tracker = createTrackerService({
    call: <T>(
      method: string,
      input: PluginRpcInput,
      outputSchema: z.ZodType<T>,
    ) => callPluginRpc("taskboard", method, input, outputSchema),
    links: createSqliteTrackerLinkStore(bb),
    rootThread: tasks.rootThread,
    threadTitle: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId });
      return thread.title ?? thread.titleFallback ?? "";
    },
    publish: (threadId) =>
      bb.realtime.publish("work-sidebar:changed", {
        family: "tracker",
        threadId,
      }),
  });
  return {
    async getWorkTracker({ threadId }) {
      return tracker.context(threadId);
    },
    async linkLinearIssue({ threadId, key }) {
      return tracker.link(threadId, key);
    },
    async searchLinearIssues({ threadId, query }) {
      return tracker.search(threadId, query);
    },
    async unlinkLinearIssue({ threadId, key }) {
      return tracker.unlink(threadId, key);
    },
    async setPrimaryLinearIssue({ threadId, key }) {
      return tracker.setPrimary(threadId, key);
    },
    async updateLinearIssueStatus({ threadId, key, statusId }) {
      return tracker.updateStatus(threadId, key, statusId);
    },
  };
}
