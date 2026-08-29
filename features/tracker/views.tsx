import { useBbNavigate } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import { SearchCombobox } from "../../components/ui/combobox";
import type { TrackerContext } from "./schemas";
import type { useTrackerSearch } from "./queries";

export function LinkedTrackerRow({
  linked,
  busy,
  primary = false,
  onSetPrimary,
  onStatus,
  onUnlink,
}: {
  linked: TrackerContext["items"][number];
  busy: boolean;
  primary?: boolean;
  onSetPrimary?(): void;
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
        {onSetPrimary ? (
          <button
            type="button"
            className="ws-text-button"
            aria-label={primary ? `${item.key} is the primary Linear issue` : `Make ${item.key} the primary Linear issue`}
            aria-pressed={primary}
            disabled={busy || primary}
            onClick={onSetPrimary}
          >
            {primary ? "Primary" : "Make primary"}
          </button>
        ) : null}
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
  const [open, setOpen] = useState(true);
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
      <SearchCombobox
        ariaLabel="Search Linear issues"
        busy={search.isFetching}
        closeOnSelect={false}
        emptyMessage={query ? "No matching issues." : "No related issues found."}
        error={search.isError ? { message: search.error.message } : null}
        listboxLabel="Suggested Linear issues"
        onOpenChange={setOpen}
        onQueryChange={onChange}
        onRetry={() => void search.refetch()}
        onSelectionChange={(values) => {
          const key = values[0];
          if (key) onLink(key);
        }}
        open={open}
        options={suggestions.map((item) => ({
          value: item.key,
          label: item.key,
          detail: item.title,
          disabled: busy,
        }))}
        placeholder="Search issues by key or title"
        portal
        query={query}
        selectedValues={[]}
      />
    </>
  );
}
