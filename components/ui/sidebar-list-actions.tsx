import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";
import { ActionTooltip } from "./action-tooltip";

type SidebarListIconButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "className"
>;

export const SidebarListIconButton = forwardRef<
  HTMLButtonElement,
  SidebarListIconButtonProps
>(function SidebarListIconButton({ type = "button", title, ...props }, ref) {
  const renderButton = (tooltipId?: string) => (
    <button {...props} ref={ref} type={type} className="ws-icon-button" aria-describedby={tooltipId} />
  );
  if (!title) return renderButton();
  return (
    <ActionTooltip label={title}>
      {renderButton}
    </ActionTooltip>
  );
});

export function SidebarListActions({
  context,
  search,
  settings,
  create,
  refresh,
}: {
  context?: ReactNode;
  search?: ReactNode;
  settings?: ReactNode;
  create?: ReactNode;
  refresh: ReactNode;
}) {
  return (
    <div className="ws-work-toolbar-actions">
      {context}
      {create}
      {search}
      {settings}
      {refresh}
    </div>
  );
}
