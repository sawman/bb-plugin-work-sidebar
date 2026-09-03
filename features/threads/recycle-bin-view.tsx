import { useEffect, useMemo, useState } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { ThreadRowContent } from "@/components/threads/thread-row-content";
import { ThreadWorkspaceBadge } from "@/components/threads/thread-workspace-badge";
import { SidebarTable } from "@/components/ui/sidebar-table";
import { ActionTooltip } from "@/components/ui/action-tooltip";
import type {
  ThreadProvider,
  ThreadProviderDirectory,
} from "@/components/threads/thread-provider-logo";
import { threadTitle } from "@/work-model";
import { archiveDurationLabel } from "./model";
import type { RecycleBinEntry } from "./recycle-bin";

type Project = { id: string; name: string; isPersonal: boolean };

export function RecycleBinView({
  entries,
  threads,
  projectsById,
  providersById,
  onRestore,
  searchQuery,
  open,
  onOpenChange,
}: {
  entries: readonly RecycleBinEntry[];
  threads: readonly PluginSidebarThread[];
  projectsById: ReadonlyMap<string, Project>;
  providersById: ThreadProviderDirectory;
  onRestore(threadId: string): void;
  searchQuery: string;
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [now, setNow] = useState(() => Date.now());
  const byId = useMemo(
    () => new Map(threads.map((thread) => [thread.id, thread])),
    [threads],
  );
  const needle = searchQuery.trim().toLocaleLowerCase();
  const rows = useMemo(
    () =>
      entries.flatMap((entry) => {
        const thread = byId.get(entry.threadId);
        if (!thread) return [];
        const project = projectsById.get(thread.projectId);
        const haystack = [
          threadTitle(thread),
          project?.name,
          thread.providerId,
          thread.environment?.branchName,
          thread.environment?.name,
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();
        return needle && !haystack.includes(needle)
          ? []
          : [{ entry, thread, project }];
      }),
    [byId, entries, needle, projectsById],
  );
  const searching = needle.length > 0;
  const effectivelyOpen = searching || open;
  return (
    <details
      className="ws-thread-group ws-recycle-bin"
      data-ws-thread-drop-zone="recycle-bin"
      open={effectivelyOpen}
      onToggle={(event) => {
        if (!searching) onOpenChange(event.currentTarget.open);
      }}
    >
      <summary>
        Recycle Bin <span>{entries.length}</span>
      </summary>
      {rows.length ? (
        <section className="ws-hierarchy" aria-label="Recycle Bin threads">
          <SidebarTable>
            {rows.map(({ entry, thread, project }) => (
              <RecycleBinRow
                key={thread.id}
                thread={thread}
                project={project}
                provider={providersById.get(thread.providerId)}
                duration={archiveDurationLabel(entry.binnedAt, now)}
                onRestore={() => onRestore(thread.id)}
              />
            ))}
          </SidebarTable>
        </section>
      ) : (
        <div className="ws-thread-group-empty">
          {searching
            ? "No matches in Recycle Bin."
            : "No threads in Recycle Bin."}
        </div>
      )}
      {effectivelyOpen && rows.length > 0 ? (
        <RecycleBinClock onTick={() => setNow(Date.now())} />
      ) : null}
    </details>
  );
}

function RecycleBinClock({ onTick }: { onTick(): void }) {
  useEffect(() => {
    const timer = window.setInterval(onTick, 60_000);
    return () => window.clearInterval(timer);
  }, [onTick]);
  return null;
}

function RecycleBinRow({
  thread,
  project,
  provider,
  duration,
  onRestore,
}: {
  thread: PluginSidebarThread;
  project?: Project;
  provider?: ThreadProvider;
  duration: string | null;
  onRestore(): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const title = threadTitle(thread);
  const projectLabel = project?.isPersonal
    ? "Personal"
    : (project?.name ?? "Project");
  return (
    <article className="ws-thread ws-recycle-bin-row">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <ActionTooltip label="Restore">
            {(tooltipId) => <button
            type="button"
            className="ws-thread-anchor ws-sidebar-row"
            onClick={onRestore}
            aria-describedby={tooltipId}
            >
            <ThreadRowContent
              providerId={thread.providerId}
              provider={provider}
              title={title}
              metadata={
                <ThreadWorkspaceBadge
                  branchName={thread.environment?.branchName ?? null}
                  environmentName={thread.environment?.name ?? null}
                  workspaceDisplayKind={
                    thread.environment?.workspaceDisplayKind ?? "other"
                  }
                  project={project}
                  projectLabel={projectLabel}
                />
              }
              trailing={
                duration ? (
                  <time
                    className="ws-thread-archive-age"
                    aria-label={`Binned ${duration} ago`}
                  >
                    {duration}
                  </time>
                ) : null
              }
            />
            </button>}
          </ActionTooltip>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${title}`}>
          <ContextMenuLabel>{title}</ContextMenuLabel>
          <ContextMenuItem onSelect={onRestore}>Restore</ContextMenuItem>
          <ContextMenuItem
            data-tone="destructive"
            onSelect={() => actions.archive(thread.id)}
          >
            Archive
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </article>
  );
}
