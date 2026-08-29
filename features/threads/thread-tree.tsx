import { useStore } from "zustand";
import { threadInteractionStore } from "./store";
import { ThreadRow } from "./thread-row";
import { threadIsWorking } from "./thread-attention";
import type { WorkThreadTreeProps } from "./thread-row-types";

export function WorkThreadTree({
  thread,
  childrenByThread,
  activeThreadId,
  selectedThreadIds,
  groupIds,
  groups,
  projectsById,
  providersById,
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
  subtextRefreshKey,
  staleWorkingMinutes,
  depth = 0,
}: WorkThreadTreeProps) {
  const children = childrenByThread.get(thread.id) ?? [];
  const activeChildren = children.filter(threadIsWorking).length;
  const childrenExpanded = useStore(threadInteractionStore, (state) =>
    state.expandedThreadIds.has(thread.id),
  );
  return (
    <>
      <ThreadRow
        key={`${thread.id}:${subtextRefreshKey}`}
        thread={thread}
        active={thread.id === activeThreadId}
        children={children.length}
        activeChildren={activeChildren}
        staleWorkingMinutes={staleWorkingMinutes}
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
        provider={providersById.get(thread.providerId)}
        onNavigate={onNavigate}
        reorderDisabled={reorderDisabled}
        dragThreadId={dragThreadId}
        onDragThreadChange={onDragThreadChange}
        dropTarget={dropTarget}
        onDropTargetChange={onDropTargetChange}
        canDropThread={(sourceId) =>
          orderedSiblings.some((sibling) => sibling.id === sourceId)
        }
        onDropThread={onDropThread}
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
              activeThreadId={activeThreadId}
              selectedThreadIds={selectedThreadIds}
              groupIds={groupIds}
              groups={groups}
              projectsById={projectsById}
              providersById={providersById}
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
              subtextRefreshKey={subtextRefreshKey}
              staleWorkingMinutes={staleWorkingMinutes}
              depth={depth + 1}
            />
          </div>
        ))}
    </>
  );
}
