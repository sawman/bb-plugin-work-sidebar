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
  const [pending, setPending] = useState<SidebarTask["assignee"] | null>(null);
  const pointerStart = useRef<number | null>(null);
  const pendingRef = useRef<SidebarTask["assignee"] | null>(null);
  const commitTimer = useRef<number | null>(null);
  const current = pending ?? value;
  const label = `${current === "agent" ? "Agent" : "Human"} assigned${taskKey ? ` to ${taskKey}` : ""}`;

  const clearPending = () => {
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    commitTimer.current = null;
    pendingRef.current = null;
    setPending(null);
  };
  const queue = (next: SidebarTask["assignee"]) => {
    if (disabled || next === value) {
      clearPending();
      return;
    }
    if (pendingRef.current === next) {
      clearPending();
      return;
    }
    if (commitTimer.current !== null) window.clearTimeout(commitTimer.current);
    pendingRef.current = next;
    setPending(next);
    commitTimer.current = window.setTimeout(() => {
      commitTimer.current = null;
      pendingRef.current = null;
      setPending(null);
      onChange(next);
    }, 2_000);
  };

  useEffect(
    () => () => {
      if (commitTimer.current !== null)
        window.clearTimeout(commitTimer.current);
    },
    [],
  );
  useEffect(() => {
    if (pending && pending === value) clearPending();
  }, [pending, value]);

  return (
    <button
      type="button"
      className="ws-assignee-toggle"
      data-assignee={current}
      data-pending={pending ?? undefined}
      disabled={disabled}
      role="switch"
      aria-checked={current === "agent"}
      aria-label={
        pending
          ? `${pending === "agent" ? "Agent" : "Human"} assignment pending for ${taskKey ?? "task"}; activate again or press Escape to cancel`
          : label
      }
      title={
        pending
          ? `Switching to ${pending === "agent" ? "Agent" : "Human"} in 2 seconds. Click again or press Escape to cancel.`
          : "Swipe left for Human, right for Agent"
      }
      onPointerDown={(event) => {
        pointerStart.current = event.clientX;
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        const start = pointerStart.current;
        pointerStart.current = null;
        if (start === null) return;
        const delta = event.clientX - start;
        if (Math.abs(delta) >= 12) queue(delta > 0 ? "agent" : "human");
        else queue(current === "agent" ? "human" : "agent");
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && pending) {
          event.preventDefault();
          clearPending();
        }
        if (event.key === "ArrowLeft") {
          event.preventDefault();
          queue("human");
        }
        if (event.key === "ArrowRight") {
          event.preventDefault();
          queue("agent");
        }
      }}
    >
      <span className="ws-assignee-toggle-viewport" aria-hidden>
        <span className="ws-assignee-toggle-track">
          <span className="ws-assignee-toggle-state">
            <Icon name="User" aria-hidden />
          </span>
          <span className="ws-assignee-toggle-state">
            <Icon name="Bot" aria-hidden />
          </span>
        </span>
      </span>
    </button>
  );
}
