import { useState } from "react";
import { Icon } from "../ui/icon";
import type { SidebarTask } from "../../work-model";

export function AssigneePicker({
  value,
  onChange,
  disabled = false,
}: {
  value: SidebarTask["assignee"];
  onChange(value: SidebarTask["assignee"]): void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const label = value === "agent" ? "Agent assigned" : "Human assigned";
  return (
    <span className="ws-assignee-picker">
      <button
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
          aria-label="Task assignee"
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
