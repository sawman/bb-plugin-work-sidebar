import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { useTracker } from "./queries";
import { ActionTooltip } from "../../components/ui/action-tooltip";

/** Header presentation only; the Work panel owns the single tracker observer. */
export function TrackerHeaderBadge({
  items,
}: {
  items: ReturnType<typeof useTracker>["data"];
}) {
  const navigate = useBbNavigate();
  return items?.items.map(({ item }) => (
    <ActionTooltip key={item.key} label={`${item.key} · ${item.title}`}>
      {(tooltipId) => <button
      type="button"
      className="ws-identifier-badge ws-work-header-badge ws-linear-header-badge"
      aria-describedby={tooltipId}
      onClick={() => navigate.openUrl(item.url)}
      >
      {item.key}
      </button>}
    </ActionTooltip>
  )) ?? null;
}
