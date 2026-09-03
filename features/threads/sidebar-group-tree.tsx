import type { DragEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ArchivedThreads } from "./archived-threads";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import { ThreadToTopDropZone } from "./thread-to-top-drop-zone";
import { RecycleBinView } from "./recycle-bin-view";
import type { RecycleBinEntry } from "./recycle-bin";
import type { QueuedMessage } from "./schemas";
import { threadTreeGroupActivity } from "./thread-attention";
import { SidebarThreadTree } from "./sidebar-thread-tree";
import { ThreadGroupSummary } from "./thread-group-summary";
import type { GroupActivityPriority } from "./group-activity-priority";
import type { ThreadPullRequestDirectory } from "../pull-requests/queries";
type SidebarGroupTreeProps = {
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  queuedMessagesByThread: ReadonlyMap<string, QueuedMessage>;
  groupActivityPriority: GroupActivityPriority;
  queuedMessageNow: number;
  searchQuery: string;
  emptyMessage: string;
  recycleBinEntries: readonly RecycleBinEntry[];
  allThreads: readonly PluginSidebarThread[];
  disclosures: Readonly<Record<string, boolean>>; onDisclosureChange(id: string, open: boolean): void; disclosuresReady: boolean;
  pullRequestsByThread?: ThreadPullRequestDirectory;
  pullRequestsLoading: boolean;
};

const sourceId = (event: DragEvent<HTMLElement>, dragThreadId: string | null) => dragThreadId ?? event.dataTransfer.getData("text/plain");

export function SidebarThreadGroups({
  organization,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  staleWorkingMinutes,
  queuedMessagesByThread,
  groupActivityPriority,
  queuedMessageNow,
  searchQuery,
  emptyMessage,
  recycleBinEntries,
  allThreads,
  disclosures, onDisclosureChange, disclosuresReady,
  pullRequestsByThread, pullRequestsLoading,
}: SidebarGroupTreeProps) {
  const sharedTreeProps = {
    organization, activeThreadId, providersById, onNavigate, subtextRefreshKey,
    staleWorkingMinutes, queuedMessagesByThread, queuedMessageNow,
    pullRequestsByThread, pullRequestsLoading,
  };
  const dropTargetId =
    organization.dropTarget?.kind === "group"
      ? organization.dropTarget.groupId
      : null;
  const searching = searchQuery.trim().length > 0;
  const showToTop = Boolean(organization.dragThreadId);
  const reparentingToTop =
    organization.dropTarget?.kind === "reparent" &&
    organization.dropTarget.parentThreadId === null;
  const clearDrop = () => {
    organization.setDragThreadId(null);
    organization.setDropTarget(null);
  };
  const setGroupTarget = (groupId: string) =>
    organization.setDropTarget({
      kind: "group",
      groupId,
    });
  const allowActiveDrop = (event: DragEvent<HTMLElement>) => {
    const id = sourceId(event, organization.dragThreadId);
    if (!id || !organization.groupIds.has(id)) return null;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return id;
  };
  const allowGroupDrop = (event: DragEvent<HTMLElement>, groupId: string) => {
    const id = sourceId(event, organization.dragThreadId);
    if (!id || organization.groupIds.get(id) === groupId) return null;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    return id;
  };
  return (
    <>
      <section className="ws-thread-statuses" aria-label="Thread status groups">
        {showToTop && <ThreadToTopDropZone active={reparentingToTop} />}
        {organization.groupPositions.map((position) => {
          const group = position.group;
          if (!group)
            return (
              <details
                key={position.id}
                className="ws-thread-group ws-active-threads"
                data-ws-thread-drop-zone="active"
                data-drop-target={dropTargetId === "active" || undefined}
                open={searching || disclosures.active !== false}
                onToggle={(event) => { if (!searching && disclosuresReady) onDisclosureChange("active", event.currentTarget.open); }}
                onDragOver={(event) => {
                  if (allowActiveDrop(event)) setGroupTarget("active");
                }}
                onDrop={(event) => {
                  const id = allowActiveDrop(event);
                  if (!id) return;
                  organization.moveToGroup(id, null);
                  clearDrop();
                }}
              >
                <ThreadGroupSummary
                  label="Active"
                  count={organization.activeRoots.length}
                  activity={threadTreeGroupActivity(
                    organization.activeRoots,
                    organization.activeChildren,
                    groupActivityPriority,
                  )}
                />
                <SidebarThreadTree
                  {...sharedTreeProps}
                  roots={organization.activeRoots}
                  childrenByThread={organization.activeChildren}
                  label="Work threads"
                />
              </details>
            );
          const tree = organization.groupedTrees.get(group.id);
          const roots = tree?.roots ?? [];
          return (
            <details
              key={group.id}
              className="ws-thread-group"
              data-ws-thread-drop-zone={group.id}
              data-drop-target={dropTargetId === group.id || undefined}
              open={searching || disclosures[group.id] !== false}
              onToggle={(event) => { if (!searching && disclosuresReady) onDisclosureChange(group.id, event.currentTarget.open); }}
              onDragOver={(event) => {
                if (allowGroupDrop(event, group.id)) setGroupTarget(group.id);
              }}
              onDrop={(event) => {
                const id = allowGroupDrop(event, group.id);
                if (!id) return;
                organization.moveToGroup(id, group.id);
                clearDrop();
              }}
            >
              <ThreadGroupSummary
                label={group.name}
                count={roots.length}
                activity={threadTreeGroupActivity(
                  roots,
                  tree?.children ?? new Map(),
                  groupActivityPriority,
                )}
              />
              {roots.length > 0 ? (
                <SidebarThreadTree
                  {...sharedTreeProps}
                  roots={roots}
                  childrenByThread={tree?.children ?? new Map()}
                  label={`${group.name} threads`}
                />
              ) : (
                <div className="ws-thread-group-empty">
                  {searching
                    ? `No matches in ${group.name}.`
                    : "Right-click a thread to move it here."}
                </div>
              )}
            </details>
          );
        })}
        <RecycleBinView
          entries={recycleBinEntries}
          groupActivityPriority={groupActivityPriority}
          threads={allThreads}
          projectsById={organization.projectsById}
          providersById={providersById}
          onRestore={(threadId) => organization.restoreFromRecycleBin(threadId)}
          searchQuery={searchQuery}
          open={disclosures["recycle-bin"] === true}
          onOpenChange={(open) => { if (disclosuresReady) onDisclosureChange("recycle-bin", open); }}
        />
        <ArchivedThreads
          threads={organization.threads}
          projectsById={organization.projectsById}
          providersById={providersById}
          onNavigate={onNavigate}
          searchQuery={searchQuery}
          open={disclosures.archive === true}
          onOpenChange={(open) => { if (disclosuresReady) onDisclosureChange("archive", open); }}
        />
      </section>
      {!searching && organization.filtered.length === 0 && (
        <div className="ws-empty">{emptyMessage}</div>
      )}
    </>
  );
}
