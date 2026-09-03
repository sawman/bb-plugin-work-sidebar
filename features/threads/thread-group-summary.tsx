import type { ThreadGroupActivity } from "./thread-attention";

const activityLabel: Record<ThreadGroupActivity, string> = {
  error: "Group has an error",
  attention: "Group needs attention",
  completed: "Group completed",
  working: "Group working",
};

/** Shared disclosure header for every thread collection in the sidebar. */
export function ThreadGroupSummary({
  label,
  count,
  activity = null,
}: {
  label: string;
  count: number | string;
  activity?: ThreadGroupActivity | null;
}) {
  return (
    <summary>
      <span className="ws-thread-group-summary-label">{label}</span>
      <span className="ws-thread-group-summary-meta">
        {activity ? (
          <span
            aria-label={activityLabel[activity]}
            className="ws-thread-group-activity"
            data-tone={activity}
            role="img"
          />
        ) : null}
        <span>{count}</span>
      </span>
    </summary>
  );
}
