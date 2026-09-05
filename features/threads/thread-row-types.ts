import type { MouseEvent as ReactMouseEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SidebarThreadGroup } from "./model";
import type {
  ThreadProvider,
  ThreadProviderDirectory,
} from "@/components/threads/thread-provider-logo";
import type { ThreadDropTarget } from "./store";
import type { QueuedMessage } from "./schemas";
import type { ThreadAgentRollup } from "./thread-agent-rollup";
import type {
  ThreadPullRequest,
  ThreadPullRequestDirectory,
} from "../pull-requests/queries";

export type { ThreadDropTarget } from "./store";

export type ThreadProject = {
  name: string;
  isPersonal: boolean;
};

export type ThreadRowProps = {
  thread: PluginSidebarThread;
  active: boolean;
  children: number;
  childAgentCount: number;
  activeChildren: number;
  staleWorkingMinutes?: number;
  queuedMessage?: QueuedMessage;
  queuedMessageNow?: number;
  childrenExpanded: boolean;
  selected: boolean;
  groupId: string | null;
  groups: readonly SidebarThreadGroup[];
  onToggleChildren(): void;
  onSelect(
    thread: PluginSidebarThread,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): boolean;
  onMoveToGroup(threadId: string, groupId: string | null): void | Promise<void>;
  onMoveToRecycleBin?(threadId: string): void;
  project?: ThreadProject;
  provider?: ThreadProvider;
  pullRequest?: ThreadPullRequest | null;
  pullRequestLoading?: boolean;
  onNavigate(): void;
  reorderDisabled: boolean;
  dragThreadId: string | null;
  onDragThreadChange(threadId: string | null): void;
  dropTarget: ThreadDropTarget;
  onDropTargetChange(target: ThreadDropTarget): void;
  canDropThread(sourceId: string): boolean;
  onDropThread(
    sourceId: string,
    targetId: string,
    placement: "before" | "after",
  ): void;
};

export type WorkThreadTreeProps = Omit<
  ThreadRowProps,
  | "active"
  | "children"
  | "childAgentCount"
  | "activeChildren"
  | "staleWorkingMinutes"
  | "childrenExpanded"
  | "selected"
  | "groupId"
  | "canDropThread"
  | "onToggleChildren"
  | "provider"
> & {
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  agentRollups: ReadonlyMap<string, ThreadAgentRollup>;
  activeThreadId: string | null;
  selectedThreadIds: ReadonlySet<string>;
  groupIds: ReadonlyMap<string, string>;
  projectsById: ReadonlyMap<string, ThreadProject>;
  providersById: ThreadProviderDirectory;
  orderedSiblings: readonly PluginSidebarThread[];
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  depth?: number;
  queuedMessagesByThread?: ReadonlyMap<string, QueuedMessage>;
  pullRequestsByThread?: ThreadPullRequestDirectory;
  pullRequestsLoading?: boolean;
};
