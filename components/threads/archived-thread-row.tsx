import {
  experimental_useSidebarThreadActions,
  experimental_useSidebarThreadSplit,
} from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import { Icon } from "../ui/icon";
import { useArchivedThreadPointerDrag } from "./use-archived-thread-pointer-drag";

export type ArchivedThread = {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  environmentBranchName: string | null;
  isPinned: boolean;
  isUnread: boolean;
  createdAt: number;
  updatedAt: number;
  archivedAt: number;
};

export function ArchivedThreadRow({
  thread,
  duration,
  project,
  groups,
  onUnarchive,
  onNavigate,
  dragging,
  onDragThreadChange,
  onDropTargetChange,
}: {
  thread: ArchivedThread;
  duration: string | null;
  project?: { name: string; isPersonal: boolean };
  groups: readonly { id: string; name: string }[];
  onUnarchive(threadId: string, destination: string | null): void;
  onNavigate(): void;
  dragging: boolean;
  onDragThreadChange(threadId: string | null): void;
  onDropTargetChange(
    target: { threadId: string; placement: "before" | "after" } | null,
  ): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(
    thread.id,
  );
  const title = thread.title || thread.titleFallback || "Untitled thread";
  const projectLabel = project?.isPersonal
    ? "Personal"
    : (project?.name ?? "Project");
  const startPointerDrag = useArchivedThreadPointerDrag({
    threadId: thread.id,
    onDragThreadChange,
    onDropTargetChange,
    onRestore: (destination) => onUnarchive(thread.id, destination),
  });
  return (
    <article
      className={`ws-thread ws-archived-thread ${dragging ? "ws-thread-dragging" : ""}`}
      onPointerDown={startPointerDrag}
    >
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a
            href="#"
            {...splitProps}
            className="ws-thread-anchor"
            onClick={(event) => {
              event.preventDefault();
              actions.open(thread.id);
              onNavigate();
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
            <span className="ws-thread-leading">
              <Icon
                name={project?.isPersonal ? "Laptop" : "FolderGit"}
                className="ws-project-icon"
                aria-label={projectLabel}
              />
            </span>
            <span className="ws-thread-main">
              <span className="ws-thread-title">{title}</span>
              <span className="ws-thread-meta">
                <span>{thread.environmentBranchName || projectLabel}</span>
                <span>Archive</span>
              </span>
            </span>
            <span className="ws-thread-trailing">
              {duration ? (
                <time
                  className="ws-thread-archive-age"
                  dateTime={new Date(thread.archivedAt).toISOString()}
                  aria-label={`Archived ${duration} ago`}
                  title={`Archived ${duration} ago`}
                >
                  {duration}
                </time>
              ) : null}
            </span>
          </a>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${title}`}>
          <ContextMenuLabel>{title}</ContextMenuLabel>
          <ContextMenuItem
            onSelect={() => {
              actions.open(thread.id);
              onNavigate();
            }}
          >
            Open
          </ContextMenuItem>
          {isAvailable && (
            <ContextMenuItem
              onSelect={() => {
                actions.open(thread.id, { split: true });
                onNavigate();
              }}
            >
              Open in split
            </ContextMenuItem>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onSelect={() => onUnarchive(thread.id, null)}>
            Active
          </ContextMenuItem>
          {groups.map((group) => (
            <ContextMenuItem
              key={group.id}
              onSelect={() => onUnarchive(thread.id, group.id)}
            >
              {group.name}
            </ContextMenuItem>
          ))}
          <ContextMenuSeparator />
          <ContextMenuItem
            className="text-destructive focus:text-destructive"
            onSelect={() => actions.requestDelete(thread.id)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </article>
  );
}
