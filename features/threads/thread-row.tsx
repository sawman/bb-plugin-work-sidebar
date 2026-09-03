import { useRef } from "react";
import { Input } from "@/components/ui/input";
import { ThreadRowContent } from "@/components/threads/thread-row-content";
import { threadTitle } from "@/work-model";
import {
  threadNeedsAttention,
  threadReportsComposerDraft,
  useStaleWorking,
} from "./thread-attention";
import { ThreadRowMenu } from "./thread-row-menu";
import { ThreadAgentControl } from "./thread-agent-control";
import { ThreadMetadata, ThreadStatus } from "./thread-row-presentation";
import { ThreadRowStackNumber } from "./thread-row-stack-number";
import type { ThreadRowProps } from "./thread-row-types";
import { useThreadRowActions } from "./use-thread-row-actions";
import { createThreadRowNativeDragHandlers } from "./thread-row-native-drag";
import { useThreadRowPointerDrag } from "./use-thread-row-pointer-drag";
import { useThreadHierarchy } from "./thread-hierarchy-context";
import { THREAD_TO_TOP_DESCRIPTION } from "./use-thread-hierarchy-menu";
import { toast } from "sonner";

export function ThreadRow({
  thread,
  active,
  children,
  childAgentCount,
  activeChildren,
  staleWorkingMinutes = 30,
  queuedMessage,
  queuedMessageNow = Date.now(),
  childrenExpanded,
  selected,
  groupId,
  groups,
  onToggleChildren,
  onSelect,
  onMoveToGroup,
  onMoveToRecycleBin,
  project,
  provider,
  pullRequest = null,
  pullRequestLoading = false,
  onNavigate,
  reorderDisabled,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  canDropThread,
  onDropThread,
}: ThreadRowProps) {
  const controlClick = useRef(false);
  const anchorRef = useRef<HTMLAnchorElement>(null);
  const hierarchy = useThreadHierarchy();
  const rowActions = useThreadRowActions({
    thread,
    groupId,
    onMoveToGroup,
    onNavigate,
  });
  const { isAvailable, startUnifiedDrag } = useThreadRowPointerDrag({
    thread,
    groupId,
    reorderDisabled,
    canDropThread,
    onDragThreadChange,
    onDropTargetChange,
    onMoveToGroup,
    onDropThread,
    onArchive: () => (onMoveToRecycleBin ?? rowActions.archiveTree)(thread.id),
    onReparentThread: (sourceId, parentThreadId) => {
      void hierarchy
        .move(sourceId, parentThreadId)
        .then(() =>
          toast.success(
            parentThreadId
              ? "Thread hierarchy updated"
              : THREAD_TO_TOP_DESCRIPTION,
          ),
        )
        .catch((error: unknown) =>
          toast.error(
            error instanceof Error ? error.message : "Could not move thread",
          ),
        );
    },
  });
  const { startNativeDrag, finishNativeDrag } = createThreadRowNativeDragHandlers({ threadId: thread.id, onDragThreadChange, onDropTargetChange });
  const projectLabel = project?.isPersonal ? "Personal" : (project?.name ?? "Project");
  const title = threadTitle(thread);
  const hasComposerDraft = threadReportsComposerDraft(thread);
  const staleWorking = useStaleWorking(thread, staleWorkingMinutes);
  return (
    <div
      className={`ws-thread ${active ? "ws-thread-active" : ""} ${selected ? "ws-thread-selected" : ""} ${dragThreadId === thread.id ? "ws-thread-dragging" : ""}`}
      data-ws-thread-id={thread.id}
      data-ws-thread-group={groupId ?? "active"}
      data-depth={thread.parentThreadId ? "child" : "root"}
      data-drop-placement={dropTarget?.kind === "reorder" && dropTarget.threadId === thread.id
        ? dropTarget.placement : undefined}
      data-reparent-target={
        dropTarget?.kind === "reparent" &&
        dropTarget.parentThreadId === thread.id
          ? "true"
          : undefined
      }
      draggable={!reorderDisabled}
      onPointerDown={startUnifiedDrag}
      onDragStart={startNativeDrag}
      onDragEnd={finishNativeDrag}
    >
      {dragThreadId ? (
        <span
          className="ws-thread-reparent-target"
          data-ws-thread-reparent-target={thread.id}
          role="note"
          aria-label={`Move a thread under ${title}`}
        />
      ) : null}
      {rowActions.renaming ? (
        <div className="ws-rename">
          <Input
            autoFocus
            value={rowActions.draftTitle}
            aria-label="Thread title"
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onChange={(event) => rowActions.setDraftTitle(event.target.value)}
            onBlur={() => void rowActions.commitRename()}
            onKeyDown={(event) => {
              if (event.key === "Enter") void rowActions.commitRename();
              if (event.key === "Escape") rowActions.cancelRename();
            }}
          />
        </div>
      ) : (
        <ThreadRowMenu
          title={title}
          threadId={thread.id}
          parentThreadId={thread.parentThreadId}
          isPinned={thread.isPinned}
          isUnread={thread.isUnread}
          isAvailable={isAvailable}
          groupId={groupId}
          groups={groups}
          onMoveToGroup={onMoveToGroup}
          onMoveToRecycleBin={onMoveToRecycleBin}
          onFocusReturn={() => anchorRef.current?.focus()}
          actions={rowActions}
        >
          <a
            ref={anchorRef}
            href="#"
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            data-sidebar-thread-parent-id={thread.parentThreadId ?? ""}
            className={`ws-thread-anchor ws-sidebar-row ${children > 0 ? "ws-thread-has-children" : ""}`}
            aria-current={selected ? "true" : undefined}
            data-selected={selected || undefined}
            onMouseDown={(event) => {
              controlClick.current = event.ctrlKey && event.button === 0;
            }}
            onClick={(event) => {
              event.preventDefault();
              if (!onSelect(thread, event)) rowActions.open(false);
            }}
            onContextMenu={(event) => {
              if (!controlClick.current && !event.ctrlKey) return;
              controlClick.current = false;
              event.preventDefault();
              onSelect(thread, event);
            }}
            onKeyDown={(event) => {
              if (
                event.key !== "ContextMenu" &&
                !(event.key === "F10" && event.shiftKey)
              )
                return;
              event.preventDefault();
              const bounds = event.currentTarget.getBoundingClientRect();
              event.currentTarget.dispatchEvent(
                new MouseEvent("contextmenu", {
                  bubbles: true,
                  clientX: bounds.left + Math.min(bounds.width, 12),
                  clientY: bounds.bottom,
                }),
              );
            }}
          >
            <ThreadRowContent
              leading={
                <ThreadAgentControl
                  thread={thread}
                  provider={provider}
                  childCount={childAgentCount}
                  activeChildren={activeChildren}
                  expanded={childrenExpanded}
                  staleWorking={staleWorking}
                  staleWorkingMinutes={staleWorkingMinutes}
                  onToggle={onToggleChildren}
                />
              }
              providerId={thread.providerId}
              provider={provider}
              title={title}
              attention={threadNeedsAttention(thread)}
              metadata={
                <ThreadMetadata
                  thread={thread}
                  project={project}
                  projectLabel={projectLabel}
                  stackNumber={
                    pullRequest ? (
                      <ThreadRowStackNumber number={pullRequest.stackNumber} />
                    ) : null
                  }
                  pullRequest={pullRequest}
                  pullRequestLoading={pullRequestLoading}
                />
              }
              trailing={
                <ThreadStatus
                  thread={thread} hasComposerDraft={hasComposerDraft} staleWorking={staleWorking}
                  staleWorkingMinutes={staleWorkingMinutes} queuedMessage={queuedMessage} queuedMessageNow={queuedMessageNow}
                />
              }
            />
          </a>
        </ThreadRowMenu>
      )}
    </div>
  );
}
