import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card";
import type { rpcContract } from "../../contracts";
import { useTracker, useTrackerMutations, useTrackerSearch } from "./queries";
import {
  LinkedTrackerRow,
  TrackerError,
  TrackerLoading,
  TrackerSearch,
} from "./views";

function useDebouncedValue(value: string, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function report(operation: Promise<unknown>, fallback: string) {
  void operation.catch((error) =>
    toast.error(error instanceof Error ? error.message : fallback),
  );
}

export function TrackerHeaderBadge({ threadId }: { threadId: string }) {
  const tracker = useTracker(threadId);
  const navigate = useBbNavigate();
  return tracker.data?.items.map(({ item }) => (
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

export function TrackerCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const tracker = useTracker(threadId);
  const [query, setQuery] = useState("");
  const search = useTrackerSearch(threadId, useDebouncedValue(query));
  const mutations = useTrackerMutations(rpc, threadId);
  const busy =
    mutations.link.isPending ||
    mutations.unlink.isPending ||
    mutations.status.isPending;
  if (tracker.isPending) return <TrackerLoading />;
  if (tracker.isError)
    return (
      <TrackerError
        message={tracker.error.message}
        retry={() => void tracker.refetch()}
      />
    );
  if (!tracker.data?.visible) return null;
  return (
    <SurfaceCard className="ws-linear-card">
      <SurfaceCardHeading title="Linear" />
      {tracker.data.items.length ? (
        <div
          className="ws-linear-linked-list"
          role="list"
          aria-label="Linked Linear issues"
        >
          {tracker.data.items.map((linked) => (
            <LinkedTrackerRow
              key={linked.item.key}
              linked={linked}
              busy={busy}
              onStatus={(statusId) =>
                report(
                  mutations.status
                    .mutateAsync({ key: linked.item.key, statusId })
                    .then((item) =>
                      toast.success(`${item.key} moved to ${item.status}`),
                    ),
                  "Could not update Linear issue",
                )
              }
              onUnlink={() =>
                report(
                  mutations.unlink
                    .mutateAsync(linked.item.key)
                    .then(() => toast.success(`${linked.item.key} unlinked`)),
                  "Could not unlink Linear issue",
                )
              }
            />
          ))}
        </div>
      ) : null}
      <TrackerSearch
        data={tracker.data}
        query={query}
        busy={busy}
        search={search}
        onChange={setQuery}
        onLink={(key) => {
          setQuery("");
          report(
            mutations.link
              .mutateAsync(key)
              .then((item) => toast.success(`${item.key} linked`)),
            "Could not link Linear issue",
          );
        }}
      />
    </SurfaceCard>
  );
}
