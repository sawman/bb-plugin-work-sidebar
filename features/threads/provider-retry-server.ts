import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { rpcContract } from "../../contracts.js";

type QueueEntry = {
  id: string;
  threadId: string;
  sendAt: number | null;
  payload: { kind: string };
};

function isQueuedRetry(
  entry: QueueEntry,
): entry is QueueEntry & {
  payload: { kind: "retry"; reason: string; attempt: number };
} {
  return entry.payload.kind === "retry";
}

/** Bridges public BB queued-retry rows into this plugin's typed data plane.
 * Provider retry keeps ownership of retry policy, scheduling, and sending. */
export function createProviderRetryRegistration(bb: BbPluginApi): Pick<
  PluginRpcHandlers<typeof rpcContract>,
  "sidebarProviderRetries"
> {
  const publish = (entry: QueueEntry) => {
    if (!isQueuedRetry(entry)) return;
    bb.realtime.publish("work-sidebar:changed", {
      family: "provider-retry",
      threadId: entry.threadId,
    });
  };
  bb.events.on("message.queued", ({ entry }) => publish(entry));
  bb.events.on("message.dispatched", ({ entry }) => publish(entry));
  return {
    async sidebarProviderRetries() {
      const rows = await bb.sdk.threads.queue.list();
      return {
        retries: rows.flatMap((row) =>
          isQueuedRetry(row)
            ? [
                {
                  id: row.id,
                  threadId: row.threadId,
                  reason: row.payload.reason,
                  attempt: row.payload.attempt,
                  sendAt: row.sendAt,
                },
              ]
            : [],
        ),
      };
    },
  };
}
