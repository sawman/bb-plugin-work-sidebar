import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import { SidebarTable } from "@/components/ui/sidebar-table";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { WorkThreadTree } from "./thread-tree";
import type { QueuedMessage } from "./schemas";

type SidebarThreadTreeProps = {
  organization: SidebarThreadOrganization;
  roots: readonly PluginSidebarThread[];
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  queuedMessagesByThread: ReadonlyMap<string, QueuedMessage>;
  queuedMessageNow: number;
  label: string;
};

/** Renders one group tree while keeping row interaction ownership in Threads. */
export function SidebarThreadTree({
  organization,
  roots,
  childrenByThread,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  staleWorkingMinutes,
  queuedMessagesByThread,
  queuedMessageNow,
  label,
}: SidebarThreadTreeProps) {
  return (
    <section className="ws-hierarchy" aria-label={label}>
      <SidebarTable>
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
            onMoveToRecycleBin={organization.moveToRecycleBin}
            orderedSiblings={roots}
            reorderDisabled={organization.reorderDisabled}
            dragThreadId={organization.dragThreadId}
            onDragThreadChange={organization.setDragThreadId}
            dropTarget={organization.dropTarget}
            onDropTargetChange={organization.setDropTarget}
            onDropThread={organization.reorder}
            subtextRefreshKey={subtextRefreshKey}
            staleWorkingMinutes={staleWorkingMinutes}
            queuedMessagesByThread={queuedMessagesByThread}
            queuedMessageNow={queuedMessageNow}
          />
        ))}
      </SidebarTable>
    </section>
  );
}
