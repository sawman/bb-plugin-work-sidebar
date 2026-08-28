import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { Input } from "../../components/ui/input";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card";
import type { TrackerContext } from "./schemas";
import type { useTrackerSearch } from "./queries";

export function TrackerLoading() {
  return (
    <SurfaceCard className="ws-empty-state-card" aria-busy="true">
      <SurfaceCardHeading title="Linear" />
      <p className="ws-card-note">Loading linked work…</p>
    </SurfaceCard>
  );
}

export function TrackerError({
  message,
  retry,
}: {
  message: string;
  retry(): void;
}) {
  return (
    <SurfaceCard className="ws-linear-card" role="alert">
      <SurfaceCardHeading title="Linear" />
      <small className="ws-linear-error">{message}</small>
      <button type="button" className="ws-text-button" onClick={retry}>
        Try again
      </button>
    </SurfaceCard>
  );
}

export function LinkedTrackerRow({
  linked,
  busy,
  onStatus,
  onUnlink,
}: {
  linked: TrackerContext["items"][number];
  busy: boolean;
  onStatus(statusId: string): void;
  onUnlink(): void;
}) {
  const navigate = useBbNavigate();
  const { item, statusOptions } = linked;
  const currentStatus =
    statusOptions.find((option) => option.current)?.id ?? "";
  return (
    <div className="ws-linear-linked-item" role="listitem">
      <button
        type="button"
        className="ws-linear-issue"
        aria-label={`${item.key}: ${item.title}`}
        onClick={() => navigate.openUrl(item.url)}
      >
        <b>{item.key}</b>
        <span>{item.title}</span>
      </button>
      <div className="ws-linear-controls">
        <select
          aria-label={`${item.key} status`}
          value={currentStatus}
          onChange={(event) => onStatus(event.target.value)}
          disabled={busy}
        >
          {statusOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ws-text-button"
          aria-label={`Unlink ${item.key}`}
          onClick={onUnlink}
          disabled={busy}
        >
          Unlink
        </button>
      </div>
    </div>
  );
}

export function TrackerSearch({
  data,
  query,
  busy,
  onChange,
  onLink,
  search,
}: {
  data: TrackerContext;
  query: string;
  busy: boolean;
  onChange(value: string): void;
  onLink(key: string): void;
  search: ReturnType<typeof useTrackerSearch>;
}) {
  const linkedKeys = new Set(
    data.items.map(({ item }) => item.key.toUpperCase()),
  );
  const suggestions = (query.trim()
    ? (search.data?.items ?? [])
    : data.suggestions
  ).filter((item) => !linkedKeys.has(item.key.toUpperCase()));
  if (!data.available)
    return (
      <small className="ws-linear-error">
        {data.message ??
          "Taskboard’s Linear connection is unavailable for this project."}
      </small>
    );
  return (
    <>
      <div className="ws-linear-search-row">
        <Input
          id="ws-linear-key"
          aria-label="Search Linear issues"
          value={query}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Search issues by key or title"
          disabled={busy}
        />
      </div>
      {search.isFetching && <small>Searching…</small>}
      {search.isError && (
        <div className="ws-linear-error" role="alert">
          <small>{search.error.message}</small>
          <button
            type="button"
            className="ws-text-button"
            onClick={() => void search.refetch()}
          >
            Try again
          </button>
        </div>
      )}
      {!search.isFetching && !search.isError && suggestions.length === 0 && (
        <small>
          {query ? "No matching issues." : "No related issues found."}
        </small>
      )}
      {suggestions.length > 0 && (
        <div
          className="ws-linear-options"
          role="listbox"
          aria-label="Suggested Linear issues"
        >
          {suggestions.map((item) => (
            <button
              key={item.key}
              type="button"
              role="option"
              aria-selected="false"
              onClick={() => onLink(item.key)}
              disabled={busy}
            >
              <b>{item.key}</b>
              <span>{item.title}</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}
