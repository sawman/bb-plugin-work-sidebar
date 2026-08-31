import type { ReactNode } from "react";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";

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
        />
      </div>
    </>
  );
}
