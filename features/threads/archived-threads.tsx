import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  ArchivedThreadRow,
  type ArchivedThread,
} from "@/components/threads/archived-thread-row";
import { archiveDurationLabel } from "./model";
import { useArchivedThreads } from "./queries";
import { SidebarTable } from "@/components/ui/sidebar-table";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";

type Project = { id: string; name: string; isPersonal: boolean };
const EMPTY_ARCHIVED_THREADS: ArchivedThread[] = [];

export function ArchivedThreads({
  threads,
  projectsById,
  providersById,
  onNavigate,
  searchQuery,
}: {
  threads: readonly PluginSidebarThread[];
  projectsById: ReadonlyMap<string, Project>;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  searchQuery: string;
}) {
  const [open, setOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const fingerprint = useMemo(
    () =>
      threads
        .map((thread) => `${thread.id}:${thread.isArchived}`)
        .sort()
        .join("|"),
    [threads],
  );
  const query = useArchivedThreads(fingerprint);
  const archived = (query.archive.data ??
    EMPTY_ARCHIVED_THREADS) as ArchivedThread[];
  const needle = searchQuery.trim().toLocaleLowerCase();
  const visibleArchived = useMemo(
    () =>
      archived.filter((thread) =>
        [
          thread.title,
          thread.titleFallback,
          projectsById.get(thread.projectId)?.name,
          thread.providerId,
          thread.environmentBranchName,
          thread.environmentName,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(needle),
      ),
    [archived, needle, projectsById],
  );
  const searching = needle.length > 0;
  const effectivelyOpen = searching || open;
  useEffect(() => {
    if (!effectivelyOpen || visibleArchived.length === 0) return undefined;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, [effectivelyOpen, visibleArchived.length]);
  const state = query.archive.isPending
    ? "loading"
    : query.archive.isError
      ? "error"
      : query.archive.isSuccess
        ? "ready"
        : "idle";
  return (
    <details
      className="ws-thread-group ws-archived"
      open={effectivelyOpen}
      onToggle={(event) => {
        if (!searching) setOpen(event.currentTarget.open);
      }}
    >
      <summary>
        Archive <span>{query.archive.data ? visibleArchived.length : ""}</span>
      </summary>
      {state === "idle" || state === "loading" ? (
        <div className="ws-thread-group-empty">Loading archive threads…</div>
      ) : state === "error" ? (
        <div className="ws-callout">
          {query.archive.error?.message ?? "Could not load archive threads."}
          <button onClick={() => void query.archive.refetch()}>
            Try again
          </button>
        </div>
      ) : visibleArchived.length > 0 ? (
        <section className="ws-hierarchy" aria-label="Archive threads">
          <SidebarTable>
            {visibleArchived.map((thread) => (
              <ArchivedThreadRow
                key={thread.id}
                thread={thread}
                duration={archiveDurationLabel(thread.archivedAt, now)}
                project={projectsById.get(thread.projectId)}
                provider={providersById.get(thread.providerId)}
                onNavigate={onNavigate}
              />
            ))}
          </SidebarTable>
        </section>
      ) : (
        <div className="ws-thread-group-empty">
          {searching ? "No matches in Archive." : "No archive threads."}
        </div>
      )}
    </details>
  );
}
