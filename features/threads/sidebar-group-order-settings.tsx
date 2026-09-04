import {
  useEffect,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { Icon } from "@/components/ui/icon";
import { ActionTooltip } from "@/components/ui/action-tooltip";
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
  onRenameGroup(group: SidebarThreadGroup, name: string): boolean;
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
  const [rename, setRename] = useState<{
    groupId: string;
    value: string;
  } | null>(null);
  const renameTriggerRefs = useRef(new Map<string, HTMLButtonElement>());
  const renameFormRef = useRef<HTMLFormElement>(null);
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
  const closeRename = (groupId = rename?.groupId) => {
    setRename(null);
    if (groupId)
      queueMicrotask(() => renameTriggerRefs.current.get(groupId)?.focus());
  };
  const commitRename = (group: SidebarThreadGroup) => {
    if (rename?.groupId !== group.id) return;
    if (settings.onRenameGroup(group, rename.value)) closeRename();
  };
  useEffect(() => {
    if (!rename) return;
    const dismissOutsideRename = (event: PointerEvent) => {
      if (renameFormRef.current?.contains(event.target as Node)) return;
      closeRename(rename.groupId);
    };
    document.addEventListener("pointerdown", dismissOutsideRename, true);
    return () =>
      document.removeEventListener("pointerdown", dismissOutsideRename, true);
  }, [rename]);
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
            {group && rename?.groupId === group.id ? (
              <form
                ref={renameFormRef}
                className="ws-thread-group-rename-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  commitRename(group);
                }}
              >
                <input
                  aria-label={`Rename ${group.name}`}
                  autoFocus
                  maxLength={40}
                  value={rename.value}
                  onChange={(event) =>
                    setRename((current) =>
                      current ? { ...current, value: event.target.value } : current,
                    )
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      commitRename(group);
                      return;
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      event.stopPropagation();
                      closeRename();
                    }
                  }}
                />
              </form>
            ) : group ? (
              <ActionTooltip label="Rename group">
                {(tooltipId) => (
                  <button
                    ref={(node) => {
                      if (node) renameTriggerRefs.current.set(group.id, node);
                      else renameTriggerRefs.current.delete(group.id);
                    }}
                    type="button"
                    className="ws-thread-group-rename"
                    aria-describedby={tooltipId}
                    onClick={() =>
                      setRename({ groupId: group.id, value: group.name })
                    }
                  >
                    {group.name}
                  </button>
                )}
              </ActionTooltip>
            ) : (
              <span className="ws-thread-group-system">Active</span>
            )}
            {group ? (
              <ActionTooltip label={occupied
                ? "Empty first"
                : "Remove"}>
                {(tooltipId) => <button
                type="button"
                className="ws-thread-group-remove"
                aria-describedby={tooltipId}
                aria-label={`Remove ${group.name}`}
                disabled={occupied}
                onClick={() => settings.onRemoveGroup(group)}
                >
                <Icon name="X" aria-hidden />
                </button>}
              </ActionTooltip>
            ) : (
              <span aria-hidden />
            )}
            <ActionTooltip label="Reorder">
              {(tooltipId) => <button
              type="button"
              className="ws-thread-group-drag"
              aria-describedby={tooltipId}
              aria-label={`Drag ${position.name} to reorder`}
              aria-keyshortcuts="ArrowUp ArrowDown"
              draggable={!settings.groupReorderPending}
              disabled={settings.groupReorderPending}
              onDragStart={(event) => startDrag(event, position.id)}
              onDragEnd={finishDrag}
              onKeyDown={(event) => moveWithKeyboard(event, position.id)}
              >
              <Icon name="GripVertical" aria-hidden />
              </button>}
            </ActionTooltip>
          </div>
        );
      })}
    </div>
  );
}
