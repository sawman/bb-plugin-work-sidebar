import { useMemo } from "react";
import type { QueuedMessage } from "./schemas";
import { useQueuedMessageInvalidation, useQueuedMessages } from "./queries";

export function queuedMessageCountdown(
  message: QueuedMessage,
  now: number,
): string | null {
  if (message.nextSendAt === null || message.nextSendAt <= now) return null;
  const minutes = Math.max(1, Math.ceil((message.nextSendAt - now) / 60_000));
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes === 0 ? `${hours}h` : `${hours}h${remainingMinutes}m`;
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

export function queuedMessageReason(message: QueuedMessage): string {
  return message.retryReason ?? message.waitingLabel ?? "Queued message";
}

export function queuedMessageLabel(message: QueuedMessage, now: number): string {
  const count = `${message.count} queued message${message.count === 1 ? "" : "s"}`;
  const countdown = queuedMessageCountdown(message, now);
  return [count, countdown ? `next sends in ${countdown}` : null, queuedMessageReason(message)].join(" · ");
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
