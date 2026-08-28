import { useState, type DragEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { ArchivedThreads } from "./archived-threads";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import { WorkThreadTree } from "./thread-tree";

type SidebarGroupTreeProps = {
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  emptyMessage: string;
};

type ThreadTreeProps = Pick<
  SidebarGroupTreeProps,
  | "activeThreadId"
  | "providersById"
  | "onNavigate"
  | "subtextRefreshKey"
> & {
  organization: SidebarThreadOrganization;
  roots: readonly PluginSidebarThread[];
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  label: string;
};

function ThreadTree({
  organization,
  roots,
  childrenByThread,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  label,
}: ThreadTreeProps) {
  return (
    <section className="ws-hierarchy" aria-label={label}>
      {roots.map((thread) => (
        <WorkThreadTree
          key={thread.id}
          thread={thread}
          childrenByThread={childrenByThread}
          activeThreadId={activeThreadId}
          selectedThreadIds={organization.selectedThreadIds}
          groupIds={organization.groupIds}
          groups={organization.groups}
          projectsById={organization.projectsById}
          providersById={providersById}
          onNavigate={onNavigate}
          onSelect={organization.selectThread}
          onMoveToGroup={organization.moveToGroup}
          orderedSiblings={roots}
          reorderDisabled={organization.reorderDisabled}
          dragThreadId={organization.dragThreadId}
          onDragThreadChange={organization.setDragThreadId}
          dropTarget={organization.dropTarget}
          onDropTargetChange={organization.setDropTarget}
          onDropThread={organization.reorder}
          onMoveThread={organization.move}
          subtextRefreshKey={subtextRefreshKey}
        />
      ))}
    </section>
  );
}

function sourceId(event: DragEvent<HTMLElement>, dragThreadId: string | null) {
  return dragThreadId ?? event.dataTransfer.getData("text/plain");
}

export function SidebarThreadGroups({
  organization,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  emptyMessage,
}: SidebarGroupTreeProps) {
  const [activeOpen, setActiveOpen] = useState(true);
  const [archivedThreadIds, setArchivedThreadIds] = useState<
    ReadonlySet<string>
  >(new Set());
  const dropTargetId = organization.dropTarget?.threadId;
  const clearDrop = () => {
    organization.setDragThreadId(null);
    organization.setDropTarget(null);
  };
  const allowActiveDrop = (event: DragEvent<HTMLElement>) => {
    const id = sourceId(event, organization.dragThreadId);
    if (!id || (!organization.groupIds.has(id) && !archivedThreadIds.has(id)))
      return null;
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
        <details
          className="ws-later ws-active-threads"
          data-ws-thread-drop-zone="active"
          data-drop-target={dropTargetId === "active" || undefined}
          open={activeOpen}
          onToggle={(event) => setActiveOpen(event.currentTarget.open)}
          onDragOver={(event) => {
            if (allowActiveDrop(event))
              organization.setDropTarget({
                threadId: "active",
                placement: "after",
              });
          }}
          onDrop={(event) => {
            const id = allowActiveDrop(event);
            if (!id) return;
            if (archivedThreadIds.has(id))
              organization.unarchiveToGroup(id, null);
            else organization.moveToGroup(id, null);
            clearDrop();
          }}
        >
          <summary>
            Active <span>{organization.activeRoots.length}</span>
          </summary>
          <ThreadTree
            organization={organization}
            roots={organization.activeRoots}
            childrenByThread={organization.activeChildren}
            activeThreadId={activeThreadId}
            providersById={providersById}
            onNavigate={onNavigate}
            subtextRefreshKey={subtextRefreshKey}
            label="Work threads"
          />
        </details>
        {organization.groups.map((group) => {
          const tree = organization.groupedTrees.get(group.id);
          const roots = tree?.roots ?? [];
          return (
            <details
              key={group.id}
              className="ws-later"
              data-ws-thread-drop-zone={group.id}
              data-drop-target={dropTargetId === group.id || undefined}
              open
              onDragOver={(event) => {
                if (allowGroupDrop(event, group.id))
                  organization.setDropTarget({
                    threadId: group.id,
                    placement: "after",
                  });
              }}
              onDrop={(event) => {
                const id = allowGroupDrop(event, group.id);
                if (!id) return;
                if (archivedThreadIds.has(id))
                  organization.unarchiveToGroup(id, group.id);
                else organization.moveToGroup(id, group.id);
                clearDrop();
              }}
            >
              <summary>
                {group.name} <span>{roots.length}</span>
              </summary>
              {roots.length > 0 ? (
                <ThreadTree
                  organization={organization}
                  roots={roots}
                  childrenByThread={tree?.children ?? new Map()}
                  activeThreadId={activeThreadId}
                  providersById={providersById}
                  onNavigate={onNavigate}
                  subtextRefreshKey={subtextRefreshKey}
                  label={`${group.name} threads`}
                />
              ) : (
                <div className="ws-later-empty">
                  Right-click a thread to move it here.
                </div>
              )}
            </details>
          );
        })}
        <ArchivedThreads
          threads={organization.threads}
          projectsById={organization.projectsById}
          providersById={providersById}
          groups={organization.groups}
          onSaveGroups={organization.saveGroups}
          onNavigate={onNavigate}
          dragThreadId={organization.dragThreadId}
          onDragThreadChange={organization.setDragThreadId}
          dropTarget={organization.dropTarget}
          onDropTargetChange={organization.setDropTarget}
          onArchive={organization.archiveThread}
          onRoster={setArchivedThreadIds}
        />
      </section>
      {organization.filtered.length === 0 && (
        <div className="ws-empty">{emptyMessage}</div>
      )}
    </>
  );
}
