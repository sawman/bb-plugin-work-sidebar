import type { MouseEvent as ReactMouseEvent } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { SidebarThreadGroup } from "./model";
import type {
  ThreadProvider,
  ThreadProviderDirectory,
} from "./thread-provider-logo";

export type ThreadDropTarget = {
  threadId: string;
  placement: "before" | "after";
} | null;

export type ThreadProject = {
  name: string;
  isPersonal: boolean;
};

export type ThreadRowProps = {
  thread: PluginSidebarThread;
  active: boolean;
  children: number;
  activeChildren: number;
  childrenExpanded: boolean;
  selected: boolean;
  groupId: string | null;
  groups: readonly SidebarThreadGroup[];
  onToggleChildren(): void;
  onSelect(
    thread: PluginSidebarThread,
    event: ReactMouseEvent<HTMLAnchorElement>,
  ): boolean;
  onMoveToGroup(threadId: string, groupId: string | null): void;
  project?: ThreadProject;
  provider?: ThreadProvider;
  onNavigate(): void;
  reorderDisabled: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
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
  onMoveThread(threadId: string, direction: -1 | 1): void;
};

export type WorkThreadTreeProps = Omit<
  ThreadRowProps,
  | "active"
  | "children"
  | "activeChildren"
  | "childrenExpanded"
  | "selected"
  | "groupId"
  | "canMoveUp"
  | "canMoveDown"
  | "canDropThread"
  | "onToggleChildren"
  | "provider"
> & {
  childrenByThread: ReadonlyMap<string, PluginSidebarThread[]>;
  activeThreadId: string | null;
  selectedThreadIds: ReadonlySet<string>;
  groupIds: ReadonlyMap<string, string>;
  projectsById: ReadonlyMap<string, ThreadProject>;
  providersById: ThreadProviderDirectory;
  orderedSiblings: readonly PluginSidebarThread[];
  subtextRefreshKey: number;
  depth?: number;
};
