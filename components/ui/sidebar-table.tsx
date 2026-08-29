import type { ReactNode } from "react";

export function SidebarTable({ children }: { children: ReactNode }) {
  return <div className="ws-sidebar-table">{children}</div>;
}
