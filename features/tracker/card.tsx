import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import type { useTracker } from "./queries";

/** Header presentation only; the Work panel owns the single tracker observer. */
export function TrackerHeaderBadge({
  items,
}: {
  items: ReturnType<typeof useTracker>["data"];
}) {
  const navigate = useBbNavigate();
  return items?.items.map(({ item }) => (
    <button
      key={item.key}
      type="button"
      className="ws-identifier-badge ws-work-header-badge ws-linear-header-badge"
      title={`${item.key} · ${item.title}`}
      onClick={() => navigate.openUrl(item.url)}
    >
      {item.key}
    </button>
  )) ?? null;
}
