import { ContextMenuItem } from "@/components/ui/context-menu";
import type { SidebarThreadGroup } from "./model";

/** Filing destinations share the same move behavior and current-group state. */
export function ThreadGroupDestinationsMenu({
  threadId,
  groupId,
  groups,
  onMoveToGroup,
}: {
  threadId: string;
  groupId: string | null;
  groups: readonly SidebarThreadGroup[];
  onMoveToGroup(threadId: string, groupId: string | null): void | Promise<void>;
}) {
  const move = (destination: string | null) => {
    void Promise.resolve(onMoveToGroup(threadId, destination)).catch(() => undefined);
  };
  return (
    <>
      <ContextMenuItem
        className="ws-thread-menu-destination"
        disabled={groupId === null}
        onSelect={() => move(null)}
      >
        Active
      </ContextMenuItem>
      {groups.map((group) => (
        <ContextMenuItem
          key={group.id}
          className="ws-thread-menu-destination"
          disabled={group.id === groupId}
          onSelect={() => move(group.id)}
        >
          {group.name}
        </ContextMenuItem>
      ))}
    </>
  );
}
