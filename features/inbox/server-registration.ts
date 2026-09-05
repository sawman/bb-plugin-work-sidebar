import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import { rpcContract } from "../../contracts.js";
import type { ServerLifecycle } from "../../server-lifecycle.js";
import { pluginStorageDatabase } from "../../shared/server-storage.js";
import {
  INBOX_AGENT_INSTRUCTIONS,
  createInboxService,
} from "./server.js";
import {
  leaveHumanMessageSchema,
  readHumanMessagesSchema,
  updateHumanMessageSchema,
} from "./schemas.js";

type InboxHandlers = Pick<PluginRpcHandlers<typeof rpcContract>,
  "listHumanMessages" | "acknowledgeHumanMessage" | "setHumanMessageBookmark">;

export const INBOX_AGENT_TOOL_NAMES = [
  "leave_human_message",
  "read_human_messages",
  "update_human_message",
] as const;

/** Lifecycle listener owns only Inbox purges; BB owns subscription removal. */
export function createInboxLifecycleSubscription({
  subscribe,
  purge,
}: {
  subscribe(event: "thread.archived" | "thread.deleted", handler: (event: { thread: { id: string } }) => void): void;
  purge(threadId: string): void;
}) {
  let current: ((threadId: string) => void) | null = purge;
  for (const event of ["thread.archived", "thread.deleted"] as const)
    subscribe(event, ({ thread }) => current?.(thread.id));
  return { dispose() { current = null; } };
}

/** RPC, tools, cleanup, and SQLite composition for the Inbox slice. */
export function createInboxRegistration(
  bb: BbPluginApi,
  lifecycle: ServerLifecycle,
): InboxHandlers & { registerTools(): void } {
  const inbox = createInboxService({
    database: pluginStorageDatabase(bb),
    getThread: async (threadId) => {
      const thread = await bb.sdk.threads.get({ threadId });
      return { id: thread.id, projectId: thread.projectId, archivedAt: thread.archivedAt };
    },
  });
  let active = true;
  lifecycle.own({ dispose() { active = false; } });
  const cleanupWarnings = new Set<string>();
  const cleanupError = (threadId: string) => {
    if (!active || lifecycle.isDisposed) return;
    if (cleanupWarnings.has(threadId)) return;
    cleanupWarnings.add(threadId);
    bb.log.warn(`Inbox cleanup failed for ${threadId}; a later lifecycle event will retry.`);
  };
  void inbox.reconcile({
    isActive: () => active && !lifecycle.isDisposed,
    onCleanupError: cleanupError,
  });
  lifecycle.own(createInboxLifecycleSubscription({
    subscribe: (event, handler) => bb.events.on(event, handler),
    purge: (threadId) => {
      try {
        inbox.markThreadClosed(threadId);
        inbox.purge(threadId);
      } catch {
        cleanupError(threadId);
      }
    },
  }));
  const publish = (threadId: string) => bb.realtime.publish("work-sidebar:changed", { family: "inbox", threadId });
  const changed = <T extends { revision: number }>(before: number, after: T, threadId: string) => {
    if (before !== after.revision) publish(threadId);
    return after;
  };
  return {
    listHumanMessages(input) { return inbox.list(input); },
    acknowledgeHumanMessage({ threadId, messageId, expectedRevision }) {
      const before = inbox.get(threadId, messageId).revision;
      return changed(before, inbox.acknowledge(threadId, messageId, expectedRevision), threadId);
    },
    setHumanMessageBookmark({ threadId, messageId, bookmarked, expectedRevision }) {
      const before = inbox.get(threadId, messageId).revision;
      return changed(before, inbox.bookmark(threadId, messageId, bookmarked, expectedRevision), threadId);
    },
    registerTools() {
      bb.agents.registerTool({
        name: "leave_human_message",
        description: "Leave one concise, durable Inbox message for the human in this thread.",
        parameters: leaveHumanMessageSchema,
        async execute(input, context) {
          const thread = await bb.sdk.threads.get({ threadId: context.threadId });
          const message = await inbox.create({
            ...input,
            threadId: context.threadId,
            projectId: thread.projectId,
            agentThreadId: context.threadId,
            providerId: thread.providerId ?? null,
            agentLabel: thread.title ?? thread.titleFallback ?? null,
          });
          if (message.changed) publish(context.threadId);
          return JSON.stringify({ id: message.id, revision: message.revision });
        },
      });
      bb.agents.registerTool({
        name: "read_human_messages",
        description: "Read one Inbox message or search this thread's durable human Inbox.",
        parameters: readHumanMessagesSchema,
        async execute(input, context) {
          return JSON.stringify(input.messageId ? inbox.get(context.threadId, input.messageId) : inbox.list({ ...input, threadId: context.threadId }));
        },
      });
      bb.agents.registerTool({
        name: "update_human_message",
        description: "Update an Inbox message created in this thread.",
        parameters: updateHumanMessageSchema,
        async execute(input, context) {
          const before = inbox.get(context.threadId, input.messageId).revision;
          const message = inbox.update(context.threadId, input.messageId, input);
          if (before !== message.revision) publish(context.threadId);
          return JSON.stringify(message);
        },
      });
    },
  };
}
