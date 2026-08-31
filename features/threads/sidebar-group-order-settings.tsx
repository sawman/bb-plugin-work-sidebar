import {
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/components/ui/icon";
import type { SidebarThreadGroup, SidebarThreadGroupPosition } from "./model";
import { AddThreadGroupControl } from "./sidebar-group-create";

export type ThreadGroupSettingsProps = {
  groupPositions: readonly SidebarThreadGroupPosition[];
  occupiedGroupIds: ReadonlySet<string>;
  groupReorderPending: boolean;
  onAddGroup(name: string): boolean;
  onMoveGroup(groupId: string, direction: -1 | 1): void;
  onReorderGroup(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
  onRenameGroup(group: SidebarThreadGroup): void;
  onRemoveGroup(group: SidebarThreadGroup): void;
};

export function ThreadGroupOrderSettings({
  settings,
}: {
  settings: ThreadGroupSettingsProps;
}) {
  const [draggedGroupId, setDraggedGroupId] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<{
    id: string;
    placement: "before" | "after";
  } | null>(null);
  const finishDrag = () => {
    setDraggedGroupId(null);
    setDragTarget(null);
  };
  const startDrag = (
    event: ReactDragEvent<HTMLButtonElement>,
    groupId: string,
  ) => {
    if (settings.groupReorderPending) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", groupId);
    setDraggedGroupId(groupId);
  };
  const moveWithKeyboard = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    groupId: string,
  ) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    settings.onMoveGroup(groupId, event.key === "ArrowUp" ? -1 : 1);
  };
  return (
    <div
      className="ws-thread-group-settings"
      role="group"
      aria-label="Thread groups"
    >
      <div className="ws-thread-group-settings-header">
        <strong>Groups</strong>
        <AddThreadGroupControl onAddGroup={settings.onAddGroup} />
      </div>
      {settings.groupPositions.map((position) => {
        const group = position.group;
        const occupied = group
          ? settings.occupiedGroupIds.has(group.id)
          : false;
        return (
          <div
            className="ws-thread-group-settings-row"
            data-group-position={position.id}
            data-drop-placement={
              dragTarget?.id === position.id
                ? dragTarget.placement
                : undefined
            }
            key={position.id}
            onDragOver={(event) => {
              if (!draggedGroupId) return;
              event.preventDefault();
              if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              setDragTarget({
                id: position.id,
                placement:
                  event.clientY < bounds.top + bounds.height / 2
                    ? "before"
                    : "after",
              });
            }}
            onDrop={(event) => {
              event.preventDefault();
              if (
                !settings.groupReorderPending &&
                draggedGroupId &&
                draggedGroupId !== position.id
              )
                settings.onReorderGroup(
                  draggedGroupId,
                  position.id,
                  dragTarget?.id === position.id
                    ? dragTarget.placement
                    : "before",
                );
              finishDrag();
            }}
          >
            {group ? (
              <button
                type="button"
                className="ws-thread-group-rename"
                title={`Rename ${group.name}`}
                onClick={() => settings.onRenameGroup(group)}
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
                onClick={() => settings.onRemoveGroup(group)}
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
              draggable={!settings.groupReorderPending}
              disabled={settings.groupReorderPending}
              onDragStart={(event) => startDrag(event, position.id)}
              onDragEnd={finishDrag}
              onKeyDown={(event) => moveWithKeyboard(event, position.id)}
            >
              <Icon name="GripVertical" aria-hidden />
            </button>
          </div>
        );
      })}
    </div>
  );
}
