import { useRef } from "react";
import {
  experimental_useSidebarThreadPullRequest,
  useComposerView,
} from "@get-bb/plugin-sdk/app";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { ThreadRowContent } from "@/components/threads/thread-row-content";
import { threadTitle } from "@/work-model";
import { threadNeedsAttention } from "./thread-attention";
import { ThreadRowMenu } from "./thread-row-menu";
import { ThreadMetadata, ThreadStatus } from "./thread-row-presentation";
import { ThreadRowStackNumber } from "./thread-row-stack-number";
import type { ThreadRowProps } from "./thread-row-types";
import { useThreadRowActions } from "./use-thread-row-actions";
import { useThreadRowPointerDrag } from "./use-thread-row-pointer-drag";

export function ThreadRow({
  thread,
  active,
  children,
  activeChildren,
  childrenExpanded,
  selected,
  groupId,
  groups,
  onToggleChildren,
  onSelect,
  onMoveToGroup,
  project,
  provider,
  onNavigate,
  reorderDisabled,
  canMoveUp,
  canMoveDown,
  dragThreadId,
  onDragThreadChange,
  dropTarget,
  onDropTargetChange,
  canDropThread,
  onDropThread,
  onMoveThread,
}: ThreadRowProps) {
  const controlClick = useRef(false);
  // Per-row opt-in: never turn this into a list-wide PR metadata read.
  const { pullRequest, isLoading: pullRequestLoading } =
    experimental_useSidebarThreadPullRequest(thread.id);
  const composerView = useComposerView();
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
    onArchive: rowActions.archiveTree,
  });
  const projectLabel = project?.isPersonal
    ? "Personal"
    : (project?.name ?? "Project");
  const title = threadTitle(thread);
  const hasComposerDraft =
    composerView.scope.kind === "thread" &&
    composerView.scope.threadId === thread.id &&
    !composerView.draft.isEmpty;
  return (
    <div
      className={`ws-thread ${active ? "ws-thread-active" : ""} ${selected ? "ws-thread-selected" : ""} ${dragThreadId === thread.id ? "ws-thread-dragging" : ""}`}
      data-ws-thread-id={thread.id}
      data-ws-thread-group={groupId ?? "active"}
      data-depth={thread.parentThreadId ? "child" : "root"}
      data-drop-placement={
        dropTarget?.threadId === thread.id ? dropTarget.placement : undefined
      }
      onPointerDown={startUnifiedDrag}
    >
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
          isPinned={thread.isPinned}
          isUnread={thread.isUnread}
          isAvailable={isAvailable}
          reorderDisabled={reorderDisabled}
          canMoveUp={canMoveUp}
          canMoveDown={canMoveDown}
          groupId={groupId}
          groups={groups}
          onMoveThread={onMoveThread}
          onMoveToGroup={onMoveToGroup}
          actions={rowActions}
        >
          <a
            href="#"
            data-sidebar-thread-shortcut-target=""
            data-sidebar-thread-id={thread.id}
            data-sidebar-thread-parent-id={thread.parentThreadId ?? ""}
            className={`ws-thread-anchor ws-sidebar-row ${children > 0 ? "ws-thread-has-children" : ""}`}
            title={
              isAvailable
                ? "Drag into the main area to open; drop at an edge to split"
                : undefined
            }
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
                children > 0 ? (
                  <button
                    type="button"
                    className={`ws-thread-agent-badge ${childrenExpanded ? "ws-thread-agent-badge-expanded" : ""}`}
                    aria-label={`${children} child agent${children === 1 ? "" : "s"}${childrenExpanded ? ", expanded" : ", collapsed"}`}
                    aria-expanded={childrenExpanded}
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      onToggleChildren();
                    }}
                  >
                    <Icon
                      name="Bot"
                      className={
                        activeChildren ? "ws-child-agent-working" : undefined
                      }
                      aria-hidden
                    />
                    <small>{children}</small>
                  </button>
                ) : undefined
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
                      <ThreadRowStackNumber threadId={thread.id} />
                    ) : null
                  }
                  pullRequest={pullRequest}
                  pullRequestLoading={pullRequestLoading}
                />
              }
              trailing={
                <ThreadStatus
                  thread={thread}
                  hasComposerDraft={hasComposerDraft}
                />
              }
            />
          </a>
        </ThreadRowMenu>
      )}
    </div>
  );
}
