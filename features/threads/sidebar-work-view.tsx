import type { ComponentType, ReactNode } from "react";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";
import type { ThreadProviderDirectory } from "./thread-provider-logo";

type SidebarWorkViewProps = {
  listMode: "enhanced" | "native";
  Original: ComponentType;
  toolbar: ReactNode;
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  emptyMessage: string;
};

export function SidebarWorkView({
  listMode,
  Original,
  toolbar,
  organization,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  emptyMessage,
}: SidebarWorkViewProps) {
  return (
    <>
      <div className="ws-list-toolbar">{toolbar}</div>
      {listMode === "native" ? (
        <section
          className="ws-native-thread-list"
          aria-label="BB native threads"
        >
          <Original />
        </section>
      ) : (
        <SidebarThreadGroups
          organization={organization}
          activeThreadId={activeThreadId}
          providersById={providersById}
          onNavigate={onNavigate}
          subtextRefreshKey={subtextRefreshKey}
          emptyMessage={emptyMessage}
        />
      )}
    </>
  );
}
