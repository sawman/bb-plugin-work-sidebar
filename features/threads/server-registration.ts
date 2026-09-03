import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import { createArchivedThreadService, createThreadPreferencesService } from "./server.js";
import { createRecycleBinExpiryHandler } from "./recycle-bin-expiry.js";
import { createSdkThreadHierarchyService, type WorkBindingReader } from "./hierarchy-server.js";
import { registerThreadSettings } from "./settings-registration.js";
import { createQueuedMessageRegistration } from "./queued-messages-server.js";
type ThreadHandlers = Pick<
  PluginRpcHandlers<typeof rpcContract>,
  "sidebarQueuedMessages" | "getSidebarOrder" | "saveSiblingOrder" | "getLaterThreads" | "saveLaterThreads" | "getThreadGroups" | "saveThreadGroups" | "getSidebarAppearance" | "saveSidebarAppearance" | "moveSidebarThread"
    | "getRecycleBin" | "binSidebarThread" | "restoreBinnedSidebarThread" | "expireRecycleBinThreads" | "sidebarArchivedThreads" | "unarchiveSidebarThread"
>;

/** Thread preference and archive RPC handlers stay with the Threads slice. */
export function createThreadRegistration(
  bb: BbPluginApi,
  work: WorkBindingReader,
): ThreadHandlers {
  registerThreadSettings(bb);
  const archived = createArchivedThreadService(bb.sdk.threads);
  const preferences = createThreadPreferencesService({
    get: (key) => bb.storage.kv.get<unknown>(key),
    set: (key, value) => bb.storage.kv.set(key, value),
    publish: (channel, payload) => bb.realtime.publish(channel, payload),
  });
  const hierarchy = createSdkThreadHierarchyService(bb, work, preferences);
  const queuedMessages = createQueuedMessageRegistration(bb);
  return {
    sidebarQueuedMessages: queuedMessages.sidebarQueuedMessages,
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
    async saveThreadGroups({ groups, activeGroupPosition, disclosures }) {
      return preferences.saveGroups(groups, activeGroupPosition, disclosures);
    },
    async getSidebarAppearance() {
      return preferences.appearance();
    },
    async saveSidebarAppearance(input) {
      if ("rowHeight" in input) return preferences.saveAppearance(input.rowHeight);
      if ("textScale" in input) return preferences.saveTextScale(input.textScale);
      if ("workingProviderAnimation" in input)
        return preferences.saveWorkingProviderAnimation(input.workingProviderAnimation);
      return preferences.saveGroupActivityPriority(input.groupActivityPriority);
    },
    async moveSidebarThread(input) {
      return hierarchy.move(input);
    },
    async getRecycleBin() {
      return { entries: await preferences.recycleBin() };
    },
    async binSidebarThread({ threadId, originGroupId }) {
      return { entries: await preferences.binThread(threadId, originGroupId) };
    },
    async restoreBinnedSidebarThread({ threadId, groupIds }) {
      return preferences.restoreBinnedThread(threadId, groupIds);
    },
    expireRecycleBinThreads: createRecycleBinExpiryHandler(
      preferences,
      (threadId) => bb.sdk.threads.archive({ threadId }),
    ),
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
