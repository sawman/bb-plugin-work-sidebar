import type { HTMLAttributes, ReactElement } from "react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import type { SidebarThreadGroup } from "./model";
import type { ThreadRowActions } from "./use-thread-row-actions";
import { useThreadHierarchyMenu } from "./use-thread-hierarchy-menu";

export function ThreadRowMenu({
  children,
  title,
  threadId,
  parentThreadId,
  isPinned,
  isUnread,
  isAvailable,
  groupId,
  groups,
  onMoveToGroup,
  onMoveToRecycleBin,
  onFocusReturn,
  actions,
}: {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  title: string;
  threadId: string;
  parentThreadId: string | null;
  isPinned: boolean;
  isUnread: boolean;
  isAvailable: boolean;
  groupId: string | null;
  groups: readonly SidebarThreadGroup[];
  onMoveToGroup(threadId: string, groupId: string | null): void;
  onMoveToRecycleBin?(threadId: string): void;
  onFocusReturn(): void;
  actions: ThreadRowActions;
}) {
  const hierarchy = useThreadHierarchyMenu({ threadId, title, onFocusReturn });
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent aria-label={`Actions for ${title}`} className="ws-thread-context-menu">
        <ContextMenuLabel>{title}</ContextMenuLabel>
        <ContextMenuItem onSelect={() => actions.setPinned(!isPinned)}>
          {isPinned ? "Unpin" : "Pin"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={() => actions.open(false)}>
          Open
        </ContextMenuItem>
        {isAvailable && (
          <ContextMenuItem onSelect={() => actions.open(true)}>
            Open in split
          </ContextMenuItem>
        )}
        <ContextMenuSeparator />
        <ContextMenuItem onSelect={() => actions.setRead(isUnread)}>
          {isUnread ? "Mark read" : "Mark unread"}
        </ContextMenuItem>
        <ContextMenuItem onSelect={actions.startRename}>Rename</ContextMenuItem>
        <ContextMenuSeparator />
        {parentThreadId ? (
          <>
            <ContextMenuItem
              disabled={hierarchy.disabled}
              title={hierarchy.toTopDescription}
              onSelect={() => void hierarchy.promote()}
            >
              To Top
            </ContextMenuItem>
          </>
        ) : null}
        <ContextMenuItem
          disabled={hierarchy.disabled}
          onSelect={(event) => hierarchy.open(event.currentTarget)}
        >
          Move under…
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="ws-thread-menu-destination"
          disabled={groupId === null}
          onSelect={() => onMoveToGroup(threadId, null)}
        >
          Active
        </ContextMenuItem>
        {groups.map((group) => (
          <ContextMenuItem
            key={group.id}
            className="ws-thread-menu-destination"
            disabled={group.id === groupId}
            onSelect={() => onMoveToGroup(threadId, group.id)}
          >
            {group.name}
          </ContextMenuItem>
        ))}
        <ContextMenuSeparator />
        <ContextMenuItem
          onSelect={() => (onMoveToRecycleBin ?? actions.archiveTree)(threadId)}
        >
          Recycle Bin
        </ContextMenuItem>
        <ContextMenuItem data-tone="destructive" onSelect={actions.archiveTree}>
          Archive
        </ContextMenuItem>
        <ContextMenuItem
          data-tone="destructive"
          onSelect={actions.requestDeleteTree}
        >
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
