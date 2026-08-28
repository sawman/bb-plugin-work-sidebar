import {
  forwardRef,
  type ComponentPropsWithoutRef,
  type ReactNode,
} from "react";

type SidebarListIconButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "className"
>;

export const SidebarListIconButton = forwardRef<
  HTMLButtonElement,
  SidebarListIconButtonProps
>(function SidebarListIconButton({ type = "button", ...props }, ref) {
  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className="ws-icon-button"
    />
  );
});

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
