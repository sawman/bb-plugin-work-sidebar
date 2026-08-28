import type { ReactNode } from "react";

export function SidebarListActions({
  context,
  create,
  refresh,
}: {
  context?: ReactNode;
  create?: ReactNode;
  refresh: ReactNode;
}) {
  return (
    <div className="ws-work-toolbar-actions">
      {context}
      {create}
      {refresh}
    </div>
  );
}
