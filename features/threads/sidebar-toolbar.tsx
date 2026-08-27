import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import type { SidebarThreadGroup } from "./model";

type SidebarToolbarProps = {
  listMode: "enhanced" | "native";
  threadCount: number;
  selectedCount: number;
  reorderDisabled: boolean;
  groups: readonly SidebarThreadGroup[];
  occupiedGroupIds: ReadonlySet<string>;
  activeProjectId: string | null;
  onSaveListMode(mode: "enhanced" | "native"): void;
  onArchiveSelected(): void;
  onAddGroup(): void;
  onRenameGroup(group: SidebarThreadGroup): void;
  onRemoveGroup(group: SidebarThreadGroup): void;
  onRefresh(): void;
  onNewThread(projectId: string): void;
};

function ThreadListSettings({
  listMode,
  groups,
  occupiedGroupIds,
  onSaveListMode,
  onAddGroup,
  onRenameGroup,
  onRemoveGroup,
}: Pick<
  SidebarToolbarProps,
  | "listMode"
  | "groups"
  | "occupiedGroupIds"
  | "onSaveListMode"
  | "onAddGroup"
  | "onRenameGroup"
  | "onRemoveGroup"
>) {
  const [open, setOpen] = useState(false);
  const saveListMode = (mode: "enhanced" | "native") => {
    setOpen(false);
    onSaveListMode(mode);
  };
  return (
    <span className="ws-thread-settings">
      <button
        className="ws-icon-button"
        title="Thread list settings"
        aria-label="Thread list settings"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="Wrench" aria-hidden />
      </button>
      {open && (
        <span className="ws-thread-settings-menu" role="menu">
          <button
            role="menuitemradio"
            aria-checked={listMode === "enhanced"}
            onClick={() => saveListMode("enhanced")}
          >
            Enhanced list
          </button>
          <button
            role="menuitemradio"
            aria-checked={listMode === "native"}
            onClick={() => saveListMode("native")}
          >
            BB native list
          </button>
          <span className="ws-thread-group-settings">
            <b>Custom groups</b>
            {groups.map((group) => {
              const occupied = occupiedGroupIds.has(group.id);
              return (
                <span key={group.id}>
                  <button
                    title={`Rename ${group.name}`}
                    onClick={() => onRenameGroup(group)}
                  >
                    {group.name}
                  </button>
                  <button
                    className="ws-thread-group-remove"
                    title={
                      occupied
                        ? "Move its threads before removing"
                        : `Remove ${group.name}`
                    }
                    aria-label={`Remove ${group.name}`}
                    disabled={occupied}
                    onClick={() => onRemoveGroup(group)}
                  >
                    <Icon name="X" aria-hidden />
                  </button>
                </span>
              );
            })}
            <button className="ws-thread-group-add" onClick={onAddGroup}>
              Add group
            </button>
          </span>
        </span>
      )}
    </span>
  );
}

export function SidebarThreadToolbar({
  listMode,
  threadCount,
  selectedCount,
  reorderDisabled,
  groups,
  occupiedGroupIds,
  activeProjectId,
  onSaveListMode,
  onArchiveSelected,
  onAddGroup,
  onRenameGroup,
  onRemoveGroup,
  onRefresh,
  onNewThread,
}: SidebarToolbarProps) {
  return (
    <>
      <span>
        {listMode === "native"
          ? "Threads"
          : `${threadCount} thread${threadCount === 1 ? "" : "s"}`}
      </span>
      <span className="ws-work-toolbar-actions">
        {listMode === "enhanced" && selectedCount > 1 && (
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
        {listMode === "enhanced" && reorderDisabled && (
          <span className="ws-reorder-disabled" role="status">
            Clear search to reorder
          </span>
        )}
        <ThreadListSettings
          listMode={listMode}
          groups={groups}
          occupiedGroupIds={occupiedGroupIds}
          onSaveListMode={onSaveListMode}
          onAddGroup={onAddGroup}
          onRenameGroup={onRenameGroup}
          onRemoveGroup={onRemoveGroup}
        />
        <button
          className="ws-icon-button"
          title="Refresh threads"
          aria-label="Refresh threads"
          onClick={onRefresh}
        >
          <Icon name="RefreshCw" aria-hidden />
        </button>
        {activeProjectId && (
          <Button
            className="ws-new-thread"
            variant="ghost"
            size="icon"
            title="New thread in project"
            aria-label="New thread in project"
            onClick={() => onNewThread(activeProjectId)}
          >
            <Icon name="Plus" aria-hidden />
          </Button>
        )}
      </span>
    </>
  );
}
