import { useEffect, useId, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { SurfaceCard } from "../../components/ui/surface-card";
import { Icon } from "../../components/ui/icon";
import { RefreshButton } from "../../components/ui/refresh-button";
import type { StorageEntry, StorageListing } from "./thread-storage-model";
import { refreshThreadStorage, useThreadStorage } from "./thread-storage-queries";
import { ThreadStorageFileLink } from "./thread-storage-file-link";

export function ThreadStorageCard({ threadId }: { threadId: string }) {
  return <ThreadStorageBoundary key={threadId} threadId={threadId} />;
}

function ThreadStorageBoundary({ threadId }: { threadId: string }) {
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const toggle = () => setOpen((value) => !value);
  return (
    <SurfaceCard data-card="thread storage">
      {open ? (
        <ThreadStorageContent threadId={threadId} id={contentId} onToggle={toggle} />
      ) : <StorageHeading open={false} id={contentId} onToggle={toggle} />}
    </SurfaceCard>
  );
}

function StorageHeading({ open, id, onToggle, trailing }: {
  open: boolean;
  id: string;
  onToggle(): void;
  trailing?: ReactNode;
}) {
  return (
    <div className="ws-card-heading">
      <button className="ws-storage-heading" type="button" aria-expanded={open} aria-controls={open ? id : undefined} onClick={onToggle}>
        <Icon name={open ? "ChevronDown" : "ChevronRight"} aria-hidden />
        <strong>Thread storage</strong>
      </button>
      {trailing}
    </div>
  );
}

function ThreadStorageContent({ threadId, id, onToggle }: { threadId: string; id: string; onToggle(): void }) {
  const query = useThreadStorage(threadId);
  const client = useQueryClient();
  return (
    <>
      <StorageHeading open id={id} onToggle={onToggle} trailing={
        <RefreshButton
          label={query.isError ? "Retry thread storage" : "Refresh thread storage"}
          refreshing={query.isFetching}
          onRefresh={() => refreshThreadStorage(client, threadId)}
        />
      } />
      <div id={id} className="ws-storage-content" aria-busy={query.isFetching || undefined}>
        {query.isPending ? <p className="ws-card-note" role="status">Loading thread storage…</p> : null}
        {query.isError ? <p className="ws-card-note" role="alert">Could not load thread storage</p> : null}
        {query.data ? <StorageFolders threadId={threadId} listing={query.data} /> : null}
      </div>
    </>
  );
}

function StorageFolders({ threadId, listing }: { threadId: string; listing: StorageListing }) {
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  useEffect(() => {
    // Preserve only disclosures that still exist in this bounded projection.
    setExpanded((previous) => {
      const retained = new Set([...previous].filter((path) => listing.entries.some((entry) => entry.kind === "directory" && entry.path === path)));
      return retained.size === previous.size ? previous : retained;
    });
  }, [listing.entries]);
  const toggleFolder = (path: string) => setExpanded((previous) => {
    const next = new Set(previous);
    if (next.has(path)) next.delete(path); else next.add(path);
    return next;
  });
  return (
    <>
      {listing.truncated ? <p className="ws-card-note">Listing incomplete; some entries are not shown.</p> : null}
      {listing.unavailable ? <p className="ws-card-note">Some entries are unavailable.</p> : null}
      {listing.entries.length === 0 && !listing.truncated && !listing.unavailable ? <p className="ws-card-note">No stored files or folders</p> : null}
      {listing.entries.length ? <StorageDirectory threadId={threadId} entries={listing.entries} parent="" expanded={expanded} onToggle={toggleFolder} /> : null}
    </>
  );
}

function StorageDirectory({ threadId, entries, parent, expanded, onToggle }: {
  threadId: string;
  entries: readonly StorageEntry[];
  parent: string;
  expanded: ReadonlySet<string>;
  onToggle(path: string): void;
}) {
  const children = entries.filter((entry) => entry.parent === parent);
  return (
    <ul className="ws-storage-list" aria-label={parent ? undefined : "Stored files and folders"}>
      {children.map((entry) => (
        <li key={entry.path}>
          {entry.kind === "directory" ? (
            <>
              <button className="ws-storage-row" type="button" aria-expanded={expanded.has(entry.path)} onClick={() => onToggle(entry.path)}>
                <Icon name={expanded.has(entry.path) ? "ChevronDown" : "ChevronRight"} aria-hidden />
                <Icon name="Folder" aria-hidden />
                <span className="ws-storage-name">{entry.name}</span>
              </button>
              {expanded.has(entry.path) ? <StorageDirectory threadId={threadId} entries={entries} parent={entry.path} expanded={expanded} onToggle={onToggle} /> : null}
            </>
          ) : (
            <ThreadStorageFileLink threadId={threadId} path={entry.path}>
              <Icon name="File" aria-hidden />
              <span className="ws-storage-name">{entry.name}</span>
            </ThreadStorageFileLink>
          )}
        </li>
      ))}
    </ul>
  );
}
