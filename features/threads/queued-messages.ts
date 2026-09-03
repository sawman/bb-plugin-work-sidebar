import { useMemo } from "react";
import type { QueuedMessage } from "./schemas";
import { useQueuedMessageInvalidation, useQueuedMessages } from "./queries";

export function queuedMessageCountdown(
  message: QueuedMessage,
  now: number,
): string | null {
  if (message.nextSendAt === null || message.nextSendAt <= now) return null;
  const seconds = Math.ceil((message.nextSendAt - now) / 1_000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function queuedMessageDisplay(
  message: QueuedMessage,
  now: number,
): string | null {
  const parts = [
    message.count > 1 ? String(message.count) : null,
    queuedMessageCountdown(message, now),
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

export function queuedMessageLabel(message: QueuedMessage, now: number): string {
  const count = `${message.count} queued message${message.count === 1 ? "" : "s"}`;
  const countdown = queuedMessageCountdown(message, now);
  const detail = message.retryReason ?? message.waitingLabel;
  return [count, countdown ? `next sends in ${countdown}` : null, detail]
    .filter((part): part is string => part !== null)
    .join(" · ");
}

/** The left sidebar is the sole owner of queued-message realtime updates. */
export function useSidebarQueuedMessages(active: boolean) {
  const queuedMessages = useQueuedMessages(active);
  useQueuedMessageInvalidation();
  return useMemo(
    () =>
      new Map(
        (queuedMessages.data ?? []).map((message) => [
          message.threadId,
          message,
        ]),
      ),
    [queuedMessages.data],
  );
}
