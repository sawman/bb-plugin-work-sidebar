import { useEffect, useRef, useState } from "react";
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
  const settingsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeSettings = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  };
  useEffect(() => {
    if (!open) return;
    dialogRef.current?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!settingsRef.current?.contains(event.target as Node))
        closeSettings({ restoreFocus: false });
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      closeSettings();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);
  const saveListMode = (mode: "enhanced" | "native") => {
    closeSettings();
    onSaveListMode(mode);
  };
  return (
    <div className="ws-thread-settings" ref={settingsRef}>
      <button
        ref={triggerRef}
        className="ws-icon-button"
        title="Thread list settings"
        aria-label="Thread list settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="Wrench" aria-hidden />
      </button>
      {open && (
        <div
          ref={dialogRef}
          className="ws-thread-settings-menu"
          role="dialog"
          aria-label="Thread list settings"
          tabIndex={-1}
        >
          <button
            aria-pressed={listMode === "enhanced"}
            onClick={() => saveListMode("enhanced")}
          >
            Enhanced list
          </button>
          <button
            aria-pressed={listMode === "native"}
            onClick={() => saveListMode("native")}
          >
            BB native list
          </button>
          <div
            className="ws-thread-group-settings"
            role="group"
            aria-label="Custom groups"
          >
            <strong>Custom groups</strong>
            {groups.map((group) => {
              const occupied = occupiedGroupIds.has(group.id);
              return (
                <div key={group.id}>
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
                </div>
              );
            })}
            <button className="ws-thread-group-add" onClick={onAddGroup}>
              Add group
            </button>
          </div>
        </div>
      )}
    </div>
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
      <div className="ws-work-toolbar-actions">
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
          <button
            type="button"
            className="ws-new-thread"
            title="New thread in project"
            aria-label="New thread in project"
            onClick={() => onNewThread(activeProjectId)}
          >
            <Icon name="Plus" aria-hidden />
          </button>
        )}
      </div>
    </>
  );
}
