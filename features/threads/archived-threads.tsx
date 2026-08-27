import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import {
  ArchivedThreadRow,
  type ArchivedThread,
} from "@/components/threads/archived-thread-row";
import type { SidebarThreadGroup } from "./model";
import { useArchivedThreads } from "./queries";

type Project = { id: string; name: string; isPersonal: boolean };
type DropTarget = { threadId: string; placement: "before" | "after" } | null;
const EMPTY_ARCHIVED_THREADS: ArchivedThread[] = [];

export function ArchivedThreads({
  threads,
  projectsById,
  groups,
  onSaveGroups,
  onNavigate,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  onArchive,
  onRoster,
}: {
  threads: readonly PluginSidebarThread[];
  projectsById: ReadonlyMap<string, Project>;
  groups: readonly SidebarThreadGroup[];
  onSaveGroups(next: SidebarThreadGroup[]): void;
  onNavigate(): void;
  dragThreadId: string | null;
  onDragThreadChange(id: string | null): void;
  dropTarget: DropTarget;
  onDropTargetChange(target: DropTarget): void;
  onArchive(id: string): void;
  onRoster(ids: ReadonlySet<string>): void;
}) {
  const [open, setOpen] = useState(false);
  const fingerprint = useMemo(
    () =>
      threads
        .map((thread) => `${thread.id}:${thread.isArchived}`)
        .sort()
        .join("|"),
    [threads],
  );
  const query = useArchivedThreads(open, fingerprint);
  const archived = (query.archive.data ?? EMPTY_ARCHIVED_THREADS) as ArchivedThread[];
  const ids = useMemo(
    () => new Set(archived.map((thread) => thread.id)),
    [archived],
  );
  useEffect(() => onRoster(ids), [ids, onRoster]);
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
      className="ws-later ws-archived"
      data-ws-thread-drop-zone="archive"
      data-drop-target={dropTarget?.threadId === "archive" || undefined}
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      onDragOver={(event) => {
        const id = dragThreadId ?? event.dataTransfer.getData("text/plain");
        if (!id || ids.has(id)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        onDropTargetChange({ threadId: "archive", placement: "after" });
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
        Archive <span>{state === "ready" ? archived.length : ""}</span>
      </summary>
      {state === "idle" || state === "loading" ? (
        <div className="ws-later-empty">Loading archive threads…</div>
      ) : state === "error" ? (
        <div className="ws-callout">
          {query.archive.error?.message ?? "Could not load archive threads."}
          <button onClick={() => void query.archive.refetch()}>
            Try again
          </button>
        </div>
      ) : archived.length > 0 ? (
        <section className="ws-hierarchy" aria-label="Archive threads">
          {archived.map((thread) => (
            <ArchivedThreadRow
              key={thread.id}
              thread={thread}
              project={projectsById.get(thread.projectId)}
              groups={groups}
              onUnarchive={unarchive}
              onNavigate={onNavigate}
              onDragThreadChange={onDragThreadChange}
              onDropTargetChange={() => onDropTargetChange(null)}
            />
          ))}
        </section>
      ) : (
        <div className="ws-later-empty">No archive threads.</div>
      )}
    </details>
  );
}
