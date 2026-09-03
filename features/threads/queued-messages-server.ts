import type { BbPluginApi, PluginRpcHandlers } from "@get-bb/plugin-sdk";
import type { rpcContract } from "../../contracts.js";

type QueueEntry = {
  threadId: string;
  sendAt: number | null;
  payload: { kind: string };
  waitingOn?: { kind: string; hostName?: string; reason?: string } | null;
};

function isQueuedRetry(
  entry: QueueEntry,
): entry is QueueEntry & { payload: { kind: "retry"; reason: string } } {
  return entry.payload.kind === "retry";
}

function waitingLabel(entry: QueueEntry): string | null {
  if (isQueuedRetry(entry)) return `Retry: ${entry.payload.reason}`;
  switch (entry.waitingOn?.kind) {
    case "thread-busy":
      return "Waiting for thread";
    case "turn-starting":
      return "Starting turn";
    case "provisioning":
      return "Provisioning environment";
    case "host-offline":
      return entry.waitingOn.hostName
        ? `Waiting for ${entry.waitingOn.hostName}`
        : "Waiting for host";
    case "interaction":
      return "Waiting for input";
    case "plugin":
      return entry.waitingOn.reason ?? "Waiting for plugin";
    case "time":
      return "Scheduled";
    default:
      return null;
  }
}

/** Bridges BB's workspace queue into one small, per-thread sidebar summary.
 * Queue policy and dispatch remain owned by BB and provider-retry. */
export function createQueuedMessageRegistration(bb: BbPluginApi): Pick<
  PluginRpcHandlers<typeof rpcContract>,
  "sidebarQueuedMessages"
> {
  const publish = (entry: QueueEntry) => {
    bb.realtime.publish("work-sidebar:changed", {
      family: "queued-message",
      threadId: entry.threadId,
    });
  };
  bb.events.on("message.queued", ({ entry }) => publish(entry));
  bb.events.on("message.dispatched", ({ entry }) => publish(entry));
  return {
    async sidebarQueuedMessages() {
      const now = Date.now();
      const messages = new Map<
        string,
        {
          threadId: string;
          count: number;
          nextSendAt: number | null;
          waitingLabel: string | null;
          retryReason: string | null;
        }
      >();
      for (const entry of await bb.sdk.threads.queue.list()) {
        const queued = messages.get(entry.threadId) ?? {
          threadId: entry.threadId,
          count: 0,
          nextSendAt: null,
          waitingLabel: null,
          retryReason: null,
        };
        queued.count += 1;
        if (entry.sendAt !== null && entry.sendAt > now) {
          queued.nextSendAt =
            queued.nextSendAt === null
              ? entry.sendAt
              : Math.min(queued.nextSendAt, entry.sendAt);
        }
        queued.waitingLabel ??= waitingLabel(entry);
        if (isQueuedRetry(entry)) queued.retryReason ??= entry.payload.reason;
        messages.set(entry.threadId, queued);
      }
      return { messages: [...messages.values()] };
    },
  };
}
