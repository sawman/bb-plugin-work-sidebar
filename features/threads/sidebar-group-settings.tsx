import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/components/ui/icon";
import { SidebarListIconButton } from "@/components/ui/sidebar-list-actions";
import type {
  SidebarThreadGroup,
  SidebarThreadGroupPosition,
} from "./model";
import { AddThreadGroupControl } from "./sidebar-group-create";

type ThreadListSettingsProps = {
  groupPositions: readonly SidebarThreadGroupPosition[];
  occupiedGroupIds: ReadonlySet<string>;
  groupReorderPending: boolean;
  onAddGroup(name: string): boolean;
  onMoveGroup(groupId: string, direction: -1 | 1): void;
  onReorderGroup(sourceId: string, targetId: string): void;
  onRenameGroup(group: SidebarThreadGroup): void;
  onRemoveGroup(group: SidebarThreadGroup): void;
};

export function ThreadListSettings({
  groupPositions,
  occupiedGroupIds,
  groupReorderPending,
  onAddGroup,
  onMoveGroup,
  onReorderGroup,
  onRenameGroup,
  onRemoveGroup,
}: ThreadListSettingsProps) {
  const [open, setOpen] = useState(false);
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragTargetId, setDragTargetId] = useState<string | null>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeSettings = ({ restoreFocus = true } = {}) => {
    setOpen(false);
    setDraggedGroupId(null);
    setDragTargetId(null);
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
  const startGroupDrag = (
    event: ReactDragEvent<HTMLButtonElement>,
    groupId: string,
  ) => {
    if (groupReorderPending) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    setDraggedGroupId(groupId);
  };
  const dropGroup = (event: ReactDragEvent<HTMLDivElement>, targetId: string) => {
    event.preventDefault();
    if (
      !groupReorderPending &&
      draggedGroupId &&
      draggedGroupId !== targetId
    )
      onReorderGroup(draggedGroupId, targetId);
    setDraggedGroupId(null);
    setDragTargetId(null);
  };
  const moveGroupWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    groupId: string,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    onMoveGroup(groupId, event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <div className="ws-thread-settings" ref={settingsRef}>
      <SidebarListIconButton
        ref={triggerRef}
        title="Thread list settings"
        aria-label="Thread list settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="Wrench" aria-hidden />
      </SidebarListIconButton>
      {open && (
        <div
          ref={dialogRef}
          className="ws-thread-settings-menu"
          role="dialog"
          aria-label="Thread list settings"
          tabIndex={-1}
        >
          <a
            className="ws-thread-settings-link"
            href="/settings/plugins/work-sidebar"
            aria-label="Open Work Sidebar settings"
            onClick={() => closeSettings({ restoreFocus: false })}
          >
            <span>Plugin settings</span>
          </a>
          <div
            className="ws-thread-group-settings"
            role="group"
            aria-label="Thread groups"
          >
            <div className="ws-thread-group-settings-header">
              <strong>Groups</strong>
              <AddThreadGroupControl onAddGroup={onAddGroup} />
            </div>
            {groupPositions.map((position) => {
              const group = position.group;
              const occupied = group
                ? occupiedGroupIds.has(group.id)
                : false;
              return (
                <div
                  className="ws-thread-group-settings-row"
                  data-group-position={position.id}
                  data-drag-target={dragTargetId === position.id || undefined}
                  key={position.id}
                  onDragEnter={() => {
                    if (draggedGroupId) setDragTargetId(position.id);
                  }}
                  onDragOver={(event) => {
                    if (!draggedGroupId) return;
                    event.preventDefault();
                    if (event.dataTransfer)
                      event.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(event) => dropGroup(event, position.id)}
                >
                  {group ? (
                    <button
                      type="button"
                      className="ws-thread-group-rename"
                      title={`Rename ${group.name}`}
                      onClick={() => onRenameGroup(group)}
                    >
                      {group.name}
                    </button>
                  ) : (
                    <span className="ws-thread-group-system">Active</span>
                  )}
                  {group ? (
                    <button
                      type="button"
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
                  ) : (
                    <span aria-hidden />
                  )}
                  <button
                    type="button"
                    className="ws-thread-group-drag"
                    title={`Drag ${position.name} to reorder`}
                    aria-label={`Drag ${position.name} to reorder`}
                    aria-keyshortcuts="ArrowUp ArrowDown"
                    draggable={!groupReorderPending}
                    disabled={groupReorderPending}
                    onDragStart={(event) =>
                      startGroupDrag(event, position.id)
                    }
                    onDragEnd={() => {
                      setDraggedGroupId(null);
                      setDragTargetId(null);
                    }}
                    onKeyDown={(event) =>
                      moveGroupWithKeyboard(event, position.id)
                    }
                  >
                    <Icon name="GripVertical" aria-hidden />
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
