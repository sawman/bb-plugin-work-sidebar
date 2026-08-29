import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  ArchivedThreadRow,
  type ArchivedThread,
} from "@/components/threads/archived-thread-row";
import type { SidebarThreadGroup } from "./model";
import { archiveDurationLabel } from "./model";
import { useArchivedThreads } from "./queries";
import { SidebarTable } from "@/components/ui/sidebar-table";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";

type Project = { id: string; name: string; isPersonal: boolean };
type DropTarget =
  | { kind: "reorder"; threadId: string; placement: "before" | "after" }
  | { kind: "reparent"; parentThreadId: string | null }
  | null;
const EMPTY_ARCHIVED_THREADS: ArchivedThread[] = [];

export function ArchivedThreads({
  threads,
  projectsById,
  providersById,
  groups,
  onSaveGroups,
  onNavigate,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  onArchive,
  onRoster,
  searchQuery,
}: {
  threads: readonly PluginSidebarThread[];
  projectsById: ReadonlyMap<string, Project>;
  providersById: ThreadProviderDirectory;
  groups: readonly SidebarThreadGroup[];
  onSaveGroups(next: SidebarThreadGroup[]): void;
  onNavigate(): void;
  dragThreadId: string | null;
  onDragThreadChange(id: string | null): void;
  dropTarget: DropTarget;
  onDropTargetChange(target: DropTarget): void;
  onArchive(id: string): void;
  onRoster(ids: ReadonlySet<string>): void;
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
  const ids = useMemo(
    () => new Set(archived.map((thread) => thread.id)),
    [archived],
  );
  useEffect(() => onRoster(ids), [ids, onRoster]);
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
  const unarchive = (id: string, destination: string | null) =>
    void query.unarchive
      .mutateAsync(id)
      .then(() => {
        if (destination)
          onSaveGroups(
            groups.map((group) =>
              group.id === destination
                ? {
                    ...group,
                    threadIds: [...new Set([...group.threadIds, id])],
                  }
                : group,
            ),
          );
        toast.success(
          `Moved to ${destination ? (groups.find((group) => group.id === destination)?.name ?? "group") : "Active"}`,
        );
      })
      .catch((error: unknown) =>
        toast.error(
          error instanceof Error ? error.message : "Could not unarchive thread",
        ),
      );
  return (
    <details
      className="ws-thread-group ws-archived"
      data-ws-thread-drop-zone="archive"
      data-drop-target={
        (dropTarget?.kind === "reorder" &&
          dropTarget.threadId === "archive") ||
        undefined
      }
      open={effectivelyOpen}
      onToggle={(event) => {
        if (!searching) setOpen(event.currentTarget.open);
      }}
      onDragOver={(event) => {
        const id = dragThreadId ?? event.dataTransfer.getData("text/plain");
        if (!id || ids.has(id)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDropTargetChange({
          kind: "reorder",
          threadId: "archive",
          placement: "after",
        });
      }}
      onDrop={(event) => {
        const id = dragThreadId ?? event.dataTransfer.getData("text/plain");
        if (!id || ids.has(id)) return;
        event.preventDefault();
        onArchive(id);
        onDragThreadChange(null);
        onDropTargetChange(null);
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
                groups={groups}
                onUnarchive={unarchive}
                onNavigate={onNavigate}
                dragging={dragThreadId === thread.id}
                onDragThreadChange={onDragThreadChange}
                onDropTargetChange={onDropTargetChange}
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
