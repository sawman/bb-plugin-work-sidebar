import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import {
  createArchivedThreadService,
  createThreadPreferencesService,
} from "./server.js";

type ThreadHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getSidebarOrder"
  | "saveSiblingOrder"
  | "getThreadListMode"
  | "saveThreadListMode"
  | "getLaterThreads"
  | "saveLaterThreads"
  | "getThreadGroups"
  | "saveThreadGroups"
  | "sidebarArchivedThreads"
  | "unarchiveSidebarThread"
>;

/** Thread preference and archive RPC handlers stay with the Threads slice. */
export function createThreadRegistration(bb: BbPluginApi): ThreadHandlers {
  const archived = createArchivedThreadService(bb.sdk.threads);
  const preferences = createThreadPreferencesService({
    get: (key) => bb.storage.kv.get<unknown>(key),
    set: (key, value) => bb.storage.kv.set(key, value),
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
  });
  return {
    async getSidebarOrder() { return { threadIds: await preferences.order() }; },
    async saveSiblingOrder({ threadIds }) {
      return { threadIds: await preferences.saveOrder(threadIds) };
    },
    async getThreadListMode() { return { mode: await preferences.listMode() }; },
    async saveThreadListMode({ mode }) {
      return { mode: await preferences.saveListMode(mode) };
    },
    async getLaterThreads() { return { threadIds: await preferences.later() }; },
    async saveLaterThreads({ threadIds }) {
      return { threadIds: await preferences.saveLater(threadIds) };
    },
    async getThreadGroups() { return { groups: await preferences.groups() }; },
    async saveThreadGroups({ groups }) {
      return { groups: await preferences.saveGroups(groups) };
    },
    async sidebarArchivedThreads() {
      try {
        return { available: true, threads: await archived.list(), error: null };
      } catch (error) {
        return {
          available: false,
          threads: [],
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async unarchiveSidebarThread({ threadId }) {
      await archived.unarchive(threadId);
      return { threadId };
    },
  };
}
