import { Icon } from "@/components/ui/icon";
import {
  SidebarListActions,
  SidebarListIconButton,
} from "@/components/ui/sidebar-list-actions";
import { RefreshButton } from "@/components/ui/refresh-button";
import type {
  SidebarThreadGroup,
  SidebarThreadGroupPosition,
} from "./model";
import { ThreadListSettings } from "./sidebar-group-settings";
type SidebarToolbarProps = {
  threadCountLabel: string;
  selectedCount: number;
  reorderDisabled: boolean;
  groupPositions: readonly SidebarThreadGroupPosition[];
  occupiedGroupIds: ReadonlySet<string>;
  groupReorderPending: boolean;
  activeProjectId: string | null;
  onArchiveSelected(): void;
  onAddGroup(name: string): boolean;
  onMoveGroup(groupId: string, direction: -1 | 1): void;
  onReorderGroup(sourceId: string, targetId: string): void;
  onRenameGroup(group: SidebarThreadGroup): void;
  onRemoveGroup(group: SidebarThreadGroup): void;
  onRefresh(): void | Promise<unknown>;
  onNewThread(projectId: string): void;
};

export function SidebarThreadToolbar({
  threadCountLabel,
  selectedCount,
  reorderDisabled,
  groupPositions,
  occupiedGroupIds,
  groupReorderPending,
  activeProjectId,
  onArchiveSelected,
  onAddGroup,
  onMoveGroup,
  onReorderGroup,
  onRenameGroup,
  onRemoveGroup,
  onRefresh,
  onNewThread,
}: SidebarToolbarProps) {
  return (
    <>
      <span>{threadCountLabel}</span>
      <SidebarListActions
        context={
          <>
            {selectedCount > 1 && (
              <>
                <span className="ws-selection-count" role="status">
                  {selectedCount} selected
                </span>
                <button
                  className="ws-selection-archive"
                  onClick={onArchiveSelected}
                >
                  Archive selected
                </button>
              </>
            )}
            {reorderDisabled && (
              <span className="ws-reorder-disabled" role="status">
                Clear search to reorder
              </span>
            )}
            <ThreadListSettings
              groupPositions={groupPositions}
              occupiedGroupIds={occupiedGroupIds}
              groupReorderPending={groupReorderPending}
              onAddGroup={onAddGroup}
              onMoveGroup={onMoveGroup}
              onReorderGroup={onReorderGroup}
              onRenameGroup={onRenameGroup}
              onRemoveGroup={onRemoveGroup}
            />
          </>
        }
        create={
          activeProjectId ? (
            <SidebarListIconButton
              title="New thread in project"
              aria-label="New thread in project"
              onClick={() => onNewThread(activeProjectId)}
            >
              <Icon name="Plus" aria-hidden />
            </SidebarListIconButton>
          ) : undefined
        }
        refresh={
          <RefreshButton label="Refresh threads" onRefresh={onRefresh} />
        }
      />
    </>
  );
}
