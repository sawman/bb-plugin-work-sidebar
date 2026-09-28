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
  reorderDisabled: boolean;
  settings: ReactNode;
  activeProjectId: string | null;
  onRefresh(): void | Promise<unknown>;
  onNewThread(projectId: string): void;
  searchQuery: string;
  onSearchQueryChange(value: string): void;
};

export function SidebarThreadToolbar({
  threadCountLabel,
  reorderDisabled,
  settings,
  activeProjectId,
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
          reorderDisabled ? (
            <span className="ws-reorder-disabled" role="status">
              Clear search to reorder
            </span>
          ) : undefined
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
