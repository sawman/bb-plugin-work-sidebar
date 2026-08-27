import { useEffect, useState } from "react";
import { useBbNavigate, useRpc } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { Input } from "../../components/ui/input";
import { SurfaceCard, SurfaceCardHeading } from "../../components/ui/surface-card";
import type { rpcContract } from "../../contracts";
import { useTracker, useTrackerMutations, useTrackerSearch } from "./queries";

function useDebouncedValue(value: string, delay = 180) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

function report(operation: Promise<unknown>, fallback: string) {
  void operation.catch((error) => toast.error(error instanceof Error ? error.message : fallback));
}

function TrackerLoading() {
  return (
    <SurfaceCard className="ws-empty-state-card" aria-busy="true">
      <SurfaceCardHeading title="Linear" />
      <p className="ws-card-note">Loading linked work…</p>
    </SurfaceCard>
  );
}

function TrackerError({ message, retry }: { message: string; retry(): void }) {
  return (
    <SurfaceCard className="ws-linear-card" role="alert">
      <SurfaceCardHeading title="Linear" />
      <small className="ws-linear-error">{message}</small>
      <button type="button" className="ws-text-button" onClick={retry}>Try again</button>
    </SurfaceCard>
  );
}

export function TrackerHeaderBadge({ threadId }: { threadId: string }) {
  const tracker = useTracker(threadId);
  const navigate = useBbNavigate();
  const item = tracker.data?.item;
  if (!item) return null;
  return <button type="button" className="ws-work-header-badge ws-linear-header-badge" title={`${item.key} · ${item.title}`} onClick={() => navigate.openUrl(item.url)}>{item.key}</button>;
}

function LinkedTrackerCard({ data, busy, onStatus, onUnlink }: { data: NonNullable<ReturnType<typeof useTracker>["data"]>; busy: boolean; onStatus(statusId: string): void; onUnlink(): void }) {
  const navigate = useBbNavigate();
  const item = data.item!;
  const currentStatus = data.statusOptions.find((option) => option.current)?.id ?? "";
  const controls = <div className="ws-linear-controls"><select aria-label="Linear issue status" value={currentStatus} onChange={(event) => onStatus(event.target.value)} disabled={busy}>{data.statusOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select><button type="button" className="ws-text-button" onClick={onUnlink} disabled={busy}>Unlink</button></div>;
  return <SurfaceCard className="ws-linear-card"><SurfaceCardHeading title="Linear" trailing={controls} /><button type="button" className="ws-linear-issue" onClick={() => navigate.openUrl(item.url)}><b>{item.key}</b><span>{item.title}</span></button></SurfaceCard>;
}

function SuggestedTrackerCard({ data, query, busy, onChange, onLink, search }: { data: NonNullable<ReturnType<typeof useTracker>["data"]>; query: string; busy: boolean; onChange(value: string): void; onLink(key: string): void; search: ReturnType<typeof useTrackerSearch> }) {
  const suggestions = query.trim() ? (search.data?.items ?? []) : data.suggestions;
  if (!data.available) return <SurfaceCard className="ws-linear-card"><SurfaceCardHeading title="Linear" /><small className="ws-linear-error">{data.message ?? "Taskboard’s Linear connection is unavailable for this project."}</small></SurfaceCard>;
  return <SurfaceCard className="ws-linear-card"><SurfaceCardHeading title="Linear" /><div className="ws-linear-options" role="listbox" aria-label="Suggested Linear issues"><div className="ws-linear-search-row"><Input id="ws-linear-key" aria-label="Search Linear issues" value={query} onChange={(event) => onChange(event.target.value)} placeholder="Search issues by key or title" disabled={busy} /></div>{search.isFetching && <small>Searching…</small>}{search.isError && <div className="ws-linear-error" role="alert"><small>{search.error.message}</small><button type="button" className="ws-text-button" onClick={() => void search.refetch()}>Try again</button></div>}{!search.isFetching && !search.isError && suggestions.length === 0 && <small>{query ? "No matching issues." : "No related issues found."}</small>}{suggestions.map((item) => <button key={item.key} type="button" role="option" aria-selected="false" onClick={() => onLink(item.key)} disabled={busy}><b>{item.key}</b><span>{item.title}</span></button>)}</div></SurfaceCard>;
}

export function TrackerCard({ threadId }: { threadId: string }) {
  const rpc = useRpc<typeof rpcContract>();
  const tracker = useTracker(threadId);
  const [query, setQuery] = useState("");
  const search = useTrackerSearch(threadId, useDebouncedValue(query));
  const mutations = useTrackerMutations(rpc, threadId);
  const busy = mutations.link.isPending || mutations.unlink.isPending || mutations.status.isPending;
  if (tracker.isPending) return <TrackerLoading />;
  if (tracker.isError) return <TrackerError message={tracker.error.message} retry={() => void tracker.refetch()} />;
  if (!tracker.data?.visible) return null;
  if (tracker.data.item) return <LinkedTrackerCard data={tracker.data} busy={busy} onStatus={(statusId) => report(mutations.status.mutateAsync(statusId).then((item) => toast.success(`${item.key} moved to ${item.status}`)), "Could not update Linear issue")} onUnlink={() => report(mutations.unlink.mutateAsync(), "Could not unlink Linear issue")} />;
  return <SuggestedTrackerCard data={tracker.data} query={query} busy={busy} search={search} onChange={setQuery} onLink={(key) => { setQuery(""); report(mutations.link.mutateAsync(key).then((item) => toast.success(`${item.key} linked`)), "Could not link Linear issue"); }} />;
}
