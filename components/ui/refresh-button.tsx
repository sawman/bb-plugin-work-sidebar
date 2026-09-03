import {
  forwardRef,
  useCallback,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Icon } from "./icon";
import { ActionTooltip } from "./action-tooltip";

type RefreshButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "children" | "className" | "onClick"
> & {
  label: string;
  refreshing?: boolean;
  onRefresh(): void | Promise<unknown>;
};

export const RefreshButton = forwardRef<
  HTMLButtonElement,
  RefreshButtonProps
>(function RefreshButton(
  {
    disabled = false,
    label,
    refreshing: ownerRefreshing = false,
    onRefresh,
    title,
    type = "button",
    ...props
  },
  ref,
) {
  const [localRefreshing, setLocalRefreshing] = useState(false);
  const refreshing = ownerRefreshing || localRefreshing;
  const refresh = useCallback(() => {
    if (disabled || refreshing) return;
    setLocalRefreshing(true);
    let result: void | Promise<unknown>;
    try {
      result = onRefresh();
    } catch {
      setLocalRefreshing(false);
      return;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => setLocalRefreshing(false));
  }, [disabled, onRefresh, refreshing]);

  return (
    <ActionTooltip label={title ?? "Refresh"}>
      {(tooltipId) => <button
      {...props}
      ref={ref}
      type={type}
      className="ws-icon-button ws-refresh-button"
      aria-label={label}
      aria-describedby={tooltipId}
      aria-busy={refreshing || undefined}
      disabled={disabled || refreshing}
      onClick={refresh}
    >
      <Icon
        name="RefreshCw"
        className="ws-refresh-icon"
        data-motion={refreshing ? "spin" : undefined}
        aria-hidden
      />
      </button>}
    </ActionTooltip>
  );
});
