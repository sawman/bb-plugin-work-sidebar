import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "../ui/context-menu";
import type { ThreadProvider } from "./thread-provider-logo";
import { ThreadRowContent } from "./thread-row-content";
import { ThreadWorkspaceBadge } from "./thread-workspace-badge";
import { ActionTooltip } from "../ui/action-tooltip";

export type ArchivedThread = {
  id: string;
  projectId: string;
  title: string | null;
  titleFallback: string | null;
  parentThreadId: string | null;
  providerId: string;
  environmentBranchName: string | null;
  environmentName: string | null;
  environmentWorkspaceDisplayKind:
    "managed-worktree" | "unmanaged-worktree" | "other";
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
  provider,
  onNavigate,
}: {
  thread: ArchivedThread;
  duration: string | null;
  project?: { name: string; isPersonal: boolean };
  provider?: ThreadProvider;
  onNavigate(): void;
}) {
  const actions = experimental_useSidebarThreadActions();
  const title = thread.title || thread.titleFallback || "Untitled thread";
  const projectLabel = project?.isPersonal
    ? "Personal"
    : (project?.name ?? "Project");
  const resume = () => {
    actions.openNewThread({ projectId: thread.projectId, focusPrompt: true });
    onNavigate();
  };
  return (
    <article className="ws-thread ws-archived-thread">
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <a
            href="#"
            className="ws-thread-anchor ws-sidebar-row"
            onClick={(event) => {
              event.preventDefault();
              resume();
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
              providerId={thread.providerId}
              provider={provider}
              title={title}
              metadata={
                <span className="ws-thread-meta ws-sidebar-row-meta">
                  <ThreadWorkspaceBadge
                    branchName={thread.environmentBranchName}
                    environmentName={thread.environmentName}
                    workspaceDisplayKind={
                      thread.environmentWorkspaceDisplayKind
                    }
                    project={project}
                    projectLabel={projectLabel}
                  />
                </span>
              }
              trailing={
                <span className="ws-thread-trailing ws-sidebar-row-trailing">
                  {duration ? (
                    <ActionTooltip label={`Archived ${duration} ago`}>
                      {(tooltipId) => <time
                      className="ws-thread-archive-age"
                      dateTime={new Date(thread.archivedAt).toISOString()}
                      aria-label={`Archived ${duration} ago`}
                      aria-describedby={tooltipId}
                    >
                      {duration}
                      </time>}
                    </ActionTooltip>
                  ) : null}
                </span>
              }
            />
          </a>
        </ContextMenuTrigger>
        <ContextMenuContent aria-label={`Actions for ${title}`}>
          <ContextMenuLabel>{title}</ContextMenuLabel>
          <ContextMenuItem onSelect={resume}>
            Resume in new worktree
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem
            data-tone="destructive"
            onSelect={() => actions.requestDelete(thread.id)}
          >
            Delete
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>
    </article>
  );
}
