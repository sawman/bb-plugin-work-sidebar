import { toast } from "sonner";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import { Icon } from "@/components/ui/icon";
import {
  DEFAULT_GROUP_ACTIVITY_PRIORITY,
  normalizeGroupActivityPriority,
  type GroupActivityPriority,
  type ThreadGroupActivity,
} from "./group-activity-priority";

const groupActivityLabel: Record<ThreadGroupActivity, string> = {
  error: "Error",
  attention: "Needs attention",
  completed: "Completed",
  working: "Working",
};

export function GroupActivityPriorityEditor({
  saved,
  pending,
  onSave,
}: {
  saved: GroupActivityPriority | undefined;
  pending: boolean;
  onSave(value: GroupActivityPriority): Promise<unknown>;
}) {
  const priority = normalizeGroupActivityPriority(
    saved ?? DEFAULT_GROUP_ACTIVITY_PRIORITY,
  );
  const move = (index: number, offset: -1 | 1) => {
    const next = [...priority];
    const target = index + offset;
    [next[index], next[target]] = [next[target]!, next[index]!];
    void onSave(next as GroupActivityPriority)
      .then(() => toast.success("Group marker priority saved"))
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error
            ? error.message
            : "Could not save group marker priority",
        ),
      );
  };
  return (
    <fieldset className="ws-sidebar-appearance-field ws-group-activity-priority">
      <legend>Group marker priority</legend>
      <small>First matching state wins.</small>
      <ol aria-label="Group marker priority" className="ws-group-activity-list">
        {priority.map((activity, index) => {
          const label = groupActivityLabel[activity];
          return (
            <li className="ws-group-activity-row" key={activity}>
              <span
                aria-hidden="true"
                className="ws-thread-group-activity"
                data-tone={activity}
              />
              <span>{label}</span>
              <span className="ws-group-activity-actions">
                <ActionTooltip label={`Move ${label} up`}>
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      aria-label={`Move ${label} up`}
                      disabled={pending || index === 0}
                      onClick={() => move(index, -1)}
                      type="button"
                    >
                      <Icon name="ChevronUp" />
                    </button>
                  )}
                </ActionTooltip>
                <ActionTooltip label={`Move ${label} down`}>
                  {(tooltipId) => (
                    <button
                      aria-describedby={tooltipId}
                      aria-label={`Move ${label} down`}
                      disabled={pending || index === priority.length - 1}
                      onClick={() => move(index, 1)}
                      type="button"
                    >
                      <Icon name="ChevronDown" />
                    </button>
                  )}
                </ActionTooltip>
              </span>
            </li>
          );
        })}
      </ol>
    </fieldset>
  );
}
