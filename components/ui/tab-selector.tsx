import type { KeyboardEvent } from "react";
import { ActionTooltip } from "./action-tooltip";

type TabSelectorItem<Value extends string> = {
  id: Value;
  label: string;
  description?: string;
};

type TabSelectorProps<Value extends string> = {
  ariaLabel: string;
  controls?: (id: Value) => string;
  idPrefix: string;
  items: readonly TabSelectorItem<Value>[];
  sticky?: boolean;
  value: Value;
  onValueChange: (value: Value) => void;
};

export function TabSelector<Value extends string>({
  ariaLabel,
  controls,
  idPrefix,
  items,
  sticky = false,
  value,
  onValueChange,
}: TabSelectorProps<Value>) {
  const selectAndFocus = (next: Value) => {
    onValueChange(next);
    window.requestAnimationFrame(() =>
      document.getElementById(`${idPrefix}-tab-${next}`)?.focus(),
    );
  };
  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const index = items.findIndex((item) => item.id === value);
    const nextIndex = event.key === "Home"
      ? 0
      : event.key === "End"
        ? items.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + items.length) %
          items.length;
    const next = items[nextIndex];
    if (next) selectAndFocus(next.id);
  };
  const tabs = Boolean(controls);

  return (
    <nav
      className={`ws-tabs${sticky ? " ws-tabs-sticky" : ""}`}
      role={tabs ? "tablist" : undefined}
      aria-label={ariaLabel}
    >
      {items.map((item) => (
        item.description ? <ActionTooltip key={item.id} label={item.description} semantic={false}>
          {(tooltipId) => <button
          key={item.id}
          id={`${idPrefix}-tab-${item.id}`}
          type="button"
          role={tabs ? "tab" : undefined}
          aria-controls={controls?.(item.id)}
          aria-selected={tabs ? value === item.id : undefined}
          aria-pressed={tabs ? undefined : value === item.id}
          tabIndex={tabs ? (value === item.id ? 0 : -1) : undefined}
          aria-describedby={tooltipId}
          onClick={() => onValueChange(item.id)}
          onKeyDown={onKeyDown}
          >
          {item.label}
          </button>}
        </ActionTooltip> : <button
          key={item.id}
          id={`${idPrefix}-tab-${item.id}`}
          type="button"
          role={tabs ? "tab" : undefined}
          aria-controls={controls?.(item.id)}
          aria-selected={tabs ? value === item.id : undefined}
          aria-pressed={tabs ? undefined : value === item.id}
          tabIndex={tabs ? (value === item.id ? 0 : -1) : undefined}
          onClick={() => onValueChange(item.id)}
          onKeyDown={onKeyDown}
        >{item.label}</button>
      ))}
    </nav>
  );
}
