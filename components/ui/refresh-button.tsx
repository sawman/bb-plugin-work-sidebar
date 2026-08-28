import {
  forwardRef,
  useCallback,
  useState,
  type ComponentPropsWithoutRef,
} from "react";
import { Icon } from "./icon";

type RefreshButtonProps = Omit<
  ComponentPropsWithoutRef<"button">,
  "aria-label" | "children" | "className" | "onClick"
> & {
  label: string;
  onRefresh(): void | Promise<unknown>;
};

export const RefreshButton = forwardRef<
  HTMLButtonElement,
  RefreshButtonProps
>(function RefreshButton(
  { disabled = false, label, onRefresh, title, type = "button", ...props },
  ref,
) {
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(() => {
    if (disabled || refreshing) return;
    setRefreshing(true);
    let result: void | Promise<unknown>;
    try {
      result = onRefresh();
    } catch {
      setRefreshing(false);
      return;
    }
    void Promise.resolve(result)
      .catch(() => undefined)
      .finally(() => setRefreshing(false));
  }, [disabled, onRefresh, refreshing]);

  return (
    <button
      {...props}
      ref={ref}
      type={type}
      className="ws-icon-button ws-refresh-button"
      aria-label={label}
      aria-busy={refreshing || undefined}
      title={title ?? label}
      disabled={disabled || refreshing}
      onClick={refresh}
    >
      <Icon
        name="RefreshCw"
        className="ws-refresh-icon"
        data-motion={refreshing ? "spin" : undefined}
        aria-hidden
      />
    </button>
  );
});
