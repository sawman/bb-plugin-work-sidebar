import { useStore } from "zustand";
import { threadInteractionStore } from "./store";
import { ThreadRow } from "./thread-row";
import { threadIsWorking } from "./thread-row-presentation";
import type { WorkThreadTreeProps } from "./thread-row-types";

export function WorkThreadTree({
  thread,
  childrenByThread,
  taskLinks,
  activeThreadId,
  selectedThreadIds,
  groupIds,
  groups,
  projectsById,
  onNavigate,
  onSelect,
  onMoveToGroup,
  orderedSiblings,
  reorderDisabled,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  onDropThread,
  onMoveThread,
  subtextRefreshKey,
  depth = 0,
}: WorkThreadTreeProps) {
  const children = childrenByThread.get(thread.id) ?? [];
  const activeChildren = children.filter(threadIsWorking).length;
  const childrenExpanded = useStore(threadInteractionStore, (state) =>
    state.expandedThreadIds.has(thread.id),
  );
  const siblingIndex = orderedSiblings.findIndex(
    (sibling) => sibling.id === thread.id,
  );
  return (
    <>
      <ThreadRow
        key={`${thread.id}:${subtextRefreshKey}`}
        thread={thread}
        active={thread.id === activeThreadId}
        taskLinks={taskLinks?.[thread.id]}
        children={children.length}
        activeChildren={activeChildren}
        childrenExpanded={childrenExpanded}
        selected={selectedThreadIds.has(thread.id)}
        groupId={groupIds.get(thread.id) ?? null}
        groups={groups}
        onToggleChildren={() =>
          threadInteractionStore.getState().toggleChildren(thread.id)
        }
        onSelect={onSelect}
        onMoveToGroup={onMoveToGroup}
        project={projectsById.get(thread.projectId)}
        onNavigate={onNavigate}
        reorderDisabled={reorderDisabled}
        canMoveUp={siblingIndex > 0}
        canMoveDown={
          siblingIndex >= 0 && siblingIndex < orderedSiblings.length - 1
        }
        dragThreadId={dragThreadId}
        onDragThreadChange={onDragThreadChange}
        dropTarget={dropTarget}
        onDropTargetChange={onDropTargetChange}
        canDropThread={(sourceId) =>
          orderedSiblings.some((sibling) => sibling.id === sourceId)
        }
        onDropThread={onDropThread}
        onMoveThread={onMoveThread}
      />
      {childrenExpanded &&
        children.map((child) => (
          <div
            key={child.id}
            className={`ws-thread-child-depth-${Math.min(depth + 1, 4)}`}
          >
            <WorkThreadTree
              thread={child}
              childrenByThread={childrenByThread}
              taskLinks={taskLinks}
              activeThreadId={activeThreadId}
              selectedThreadIds={selectedThreadIds}
              groupIds={groupIds}
              groups={groups}
              projectsById={projectsById}
              onNavigate={onNavigate}
              onSelect={onSelect}
              onMoveToGroup={onMoveToGroup}
              orderedSiblings={children}
              reorderDisabled={reorderDisabled}
              dragThreadId={dragThreadId}
              onDragThreadChange={onDragThreadChange}
              dropTarget={dropTarget}
              onDropTargetChange={onDropTargetChange}
              onDropThread={onDropThread}
              onMoveThread={onMoveThread}
              subtextRefreshKey={subtextRefreshKey}
              depth={depth + 1}
            />
          </div>
        ))}
    </>
  );
}
