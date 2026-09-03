import { Icon } from "@/components/ui/icon";

/** Shared disclosure header for every thread collection in the sidebar. */
export function ThreadGroupSummary({
  label,
  count,
  needsAttention = false,
}: {
  label: string;
  count: number | string;
  needsAttention?: boolean;
}) {
  return (
    <summary>
      <span className="ws-thread-group-summary-label">{label}</span>
      <span className="ws-thread-group-summary-meta">
        <span>{count}</span>
        {needsAttention ? (
          <Icon
            name="AlertCircle"
            className="ws-thread-group-attention"
            aria-label="Attention needed"
          />
        ) : null}
      </span>
    </summary>
  );
}
