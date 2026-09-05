import { Icon } from "@/components/ui/icon";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { THREAD_ACTIVITY_PRESENTATION } from "@/shared/thread-activity";
import {
  queuedMessageDisplay,
  queuedMessageLabel,
  queuedMessageReason,
} from "./queued-messages";
import type { QueuedMessage } from "./schemas";

export function ThreadQueuedStatus({
  message,
  now,
}: {
  message: QueuedMessage;
  now: number;
}) {
  const presentation = THREAD_ACTIVITY_PRESENTATION.queued;
  const display = queuedMessageDisplay(message, now);
  const scheduled = message.nextSendAt !== null && message.nextSendAt > now;
  return (
    <ActionTooltip label={queuedMessageReason(message)}>
      {(tooltipId) => (
        <span
          className="ws-queued-message"
          data-thread-activity-state="queued"
          data-scheduled={scheduled || undefined}
          role="status"
          aria-label={queuedMessageLabel(message, now)}
          aria-describedby={tooltipId}
        >
          <Icon name={scheduled ? "Clock" : presentation.icon} aria-hidden />
          {display ? <span aria-hidden>{display}</span> : null}
        </span>
      )}
    </ActionTooltip>
  );
}
