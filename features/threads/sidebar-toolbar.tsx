import { Icon } from "@/components/ui/icon";
import type { ReactNode } from "react";
import {
  SidebarListActions,
  SidebarListIconButton,
} from "@/components/ui/sidebar-list-actions";
import { RefreshButton } from "@/components/ui/refresh-button";
import { SidebarSearch } from "@/components/ui/sidebar-search";
type SidebarToolbarProps = {
  threadCountLabel: string;
  selectedCount: number;
  reorderDisabled: boolean;
  settings: ReactNode;
  activeProjectId: string | null;
  onArchiveSelected(): void;
  onRefresh(): void | Promise<unknown>;
  onNewThread(projectId: string): void;
  searchQuery: string;
  onSearchQueryChange(value: string): void;
};

export function SidebarThreadToolbar({
  threadCountLabel,
  selectedCount,
  reorderDisabled,
  settings,
  activeProjectId,
  onArchiveSelected,
  onRefresh,
  onNewThread,
  searchQuery,
  onSearchQueryChange,
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
          </>
        }
        search={
          <SidebarSearch
            label="threads"
            value={searchQuery}
            onValueChange={onSearchQueryChange}
          />
        }
        settings={settings}
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
