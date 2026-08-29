import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import { createArchivedThreadService, createThreadPreferencesService } from "./server.js";
import { createSdkThreadHierarchyService, type WorkBindingReader } from "./hierarchy-server.js";

type ThreadHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  | "getSidebarOrder"
  | "saveSiblingOrder"
  | "getLaterThreads"
  | "saveLaterThreads"
  | "getThreadGroups"
  | "saveThreadGroups"
  | "getSidebarAppearance"
  | "saveSidebarAppearance"
  | "moveSidebarThread"
  | "sidebarArchivedThreads"
  | "unarchiveSidebarThread"
>;

/** Thread preference and archive RPC handlers stay with the Threads slice. */
export function createThreadRegistration(
  bb: BbPluginApi,
  work: WorkBindingReader,
): ThreadHandlers {
  bb.settings.define({
    stuckThreadMinutes: {
      type: "select",
      label: "Stuck thread timeout",
      description:
        "Show a clock when an active runtime, goal, plan, or background job has produced no update for this long.",
      options: ["15", "30", "45", "60", "120"],
      default: "30",
    },
  });
  const archived = createArchivedThreadService(bb.sdk.threads);
  const preferences = createThreadPreferencesService({
    get: (key) => bb.storage.kv.get<unknown>(key),
    set: (key, value) => bb.storage.kv.set(key, value),
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
  });
  const hierarchy = createSdkThreadHierarchyService(bb, work, preferences);
  return {
    async getSidebarOrder() {
      return { threadIds: await preferences.order() };
    },
    async saveSiblingOrder({ threadIds }) {
      return { threadIds: await preferences.saveOrder(threadIds) };
    },
    async getLaterThreads() {
      return { threadIds: await preferences.later() };
    },
    async saveLaterThreads({ threadIds }) {
      return { threadIds: await preferences.saveLater(threadIds) };
    },
    async getThreadGroups() {
      return preferences.groups();
    },
    async saveThreadGroups({ groups, activeGroupPosition }) {
      return preferences.saveGroups(groups, activeGroupPosition);
    },
    async getSidebarAppearance() {
      return preferences.appearance();
    },
    async saveSidebarAppearance({ rowHeight }) {
      return preferences.saveAppearance(rowHeight);
    },
    async moveSidebarThread(input) {
      return hierarchy.move(input);
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
