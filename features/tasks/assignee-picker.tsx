import { useEffect, useRef, useState } from "react";
import { Icon } from "../../components/ui/icon";
import type { SidebarTask } from "../../work-model";

export function AssigneePicker({
  value,
  onChange,
  disabled = false,
  taskKey,
}: {
  value: SidebarTask["assignee"];
  onChange(value: SidebarTask["assignee"]): void;
  disabled?: boolean;
  taskKey?: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const label = `${value === "agent" ? "Agent" : "Human"} assigned${taskKey ? ` to ${taskKey}` : ""}`;
  const listLabel = `Task assignee${taskKey ? ` for ${taskKey}` : ""}`;

  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const dismissWithEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismissOutside, true);
    document.addEventListener("keydown", dismissWithEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside, true);
      document.removeEventListener("keydown", dismissWithEscape);
    };
  }, [open]);

  return (
    <span className="ws-assignee-picker" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        className="ws-assignee-trigger"
        aria-label={label}
        title={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name={value === "agent" ? "Bot" : "User"} aria-hidden />
        <span>⌄</span>
      </button>
      {open && (
        <span
          className="ws-assignee-options"
          role="listbox"
          aria-label={listLabel}
        >
          <button
            type="button"
            role="option"
            aria-selected={value === "human"}
            onClick={() => {
              onChange("human");
              setOpen(false);
            }}
          >
            <Icon name="User" aria-hidden />
            Human
          </button>
          <button
            type="button"
            role="option"
            aria-selected={value === "agent"}
            onClick={() => {
              onChange("agent");
              setOpen(false);
            }}
          >
            <Icon name="Bot" aria-hidden />
            Agent
          </button>
        </span>
      )}
    </span>
  );
}
