import type { ReactNode } from "react";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RecycleBinEntry } from "./recycle-bin";

type SidebarWorkViewProps = {
  toolbar: ReactNode;
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  searchQuery: string;
  emptyMessage: string;
  recycleBinEntries: readonly RecycleBinEntry[];
  allThreads: readonly PluginSidebarThread[];
};

export function SidebarWorkView({
  toolbar,
  organization,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  staleWorkingMinutes,
  searchQuery,
  emptyMessage,
  recycleBinEntries,
  allThreads,
}: SidebarWorkViewProps) {
  return (
    <>
      <div className="ws-list-toolbar">{toolbar}</div>
      <div className="ws-view-content">
        <SidebarThreadGroups
          organization={organization}
          activeThreadId={activeThreadId}
          providersById={providersById}
          onNavigate={onNavigate}
          subtextRefreshKey={subtextRefreshKey}
          staleWorkingMinutes={staleWorkingMinutes}
          searchQuery={searchQuery}
          emptyMessage={emptyMessage}
          recycleBinEntries={recycleBinEntries}
          allThreads={allThreads}
        />
      </div>
    </>
  );
}
