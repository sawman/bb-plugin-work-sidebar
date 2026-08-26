import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "../ui/context-menu";
import { Icon } from "../ui/icon";

export type ArchivedThread = {
  id: string; projectId: string; title: string | null; titleFallback: string | null; parentThreadId: string | null;
  environmentBranchName: string | null; isPinned: boolean; isUnread: boolean; createdAt: number; updatedAt: number; archivedAt: number;
};

export function ArchivedThreadRow({ thread, project, onUnarchive, onNavigate }: { thread: ArchivedThread; project?: { name: string; isPersonal: boolean }; onUnarchive(threadId: string, destination: "active" | "later"): void; onNavigate(): void }) {
  const actions = experimental_useSidebarThreadActions();
  const title = thread.title || thread.titleFallback || "Untitled thread";
  const projectLabel = project?.isPersonal ? "Personal" : project?.name ?? "Project";
  return <article className="ws-thread ws-archived-thread"><ContextMenu><ContextMenuTrigger asChild><a href="#" className="ws-thread-anchor" onClick={(event) => { event.preventDefault(); actions.open(thread.id); onNavigate(); }}><Icon name={project?.isPersonal ? "Laptop" : "FolderGit"} className="ws-project-icon" aria-label={projectLabel} /><span className="ws-thread-main"><span className="ws-thread-title">{title}</span><span className="ws-thread-meta"><span>{thread.environmentBranchName || projectLabel}</span><span>Archive</span></span></span></a></ContextMenuTrigger><ContextMenuContent aria-label={`Actions for ${title}`}><ContextMenuLabel>{title}</ContextMenuLabel><ContextMenuItem onSelect={() => { actions.open(thread.id); onNavigate(); }}>Open</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem onSelect={() => onUnarchive(thread.id, "active")}>Active</ContextMenuItem><ContextMenuItem onSelect={() => onUnarchive(thread.id, "later")}>Later</ContextMenuItem><ContextMenuSeparator /><ContextMenuItem className="text-destructive focus:text-destructive" onSelect={() => actions.requestDelete(thread.id)}>Delete</ContextMenuItem></ContextMenuContent></ContextMenu></article>;
}
