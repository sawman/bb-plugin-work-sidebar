import type { ComponentType, ReactNode } from "react";
import type { ThreadTaskLink } from "@/work-model";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";

type SidebarWorkViewProps = {
  listMode: "enhanced" | "native";
  Original: ComponentType;
  toolbar: ReactNode;
  organization: SidebarThreadOrganization;
  taskLinks: Readonly<Record<string, readonly ThreadTaskLink[]>>;
  activeThreadId: string | null;
  onNavigate(): void;
  subtextRefreshKey: number;
  emptyMessage: string;
};

export function SidebarWorkView({
  listMode,
  Original,
  toolbar,
  organization,
  taskLinks,
  activeThreadId,
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
          taskLinks={taskLinks}
          activeThreadId={activeThreadId}
          onNavigate={onNavigate}
          subtextRefreshKey={subtextRefreshKey}
          emptyMessage={emptyMessage}
        />
      )}
    </>
  );
}
