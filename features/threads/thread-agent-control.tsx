import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadProvider } from "@/components/threads/thread-provider-logo";
import { ThreadRuntimeProvider } from "./thread-row-presentation";

/** The compact row reserves two characters; the accessible label keeps the exact count. */
export function childAgentCountDisplay(childCount: number) {
  return childCount > 99 ? "∞" : String(childCount);
}

export function ThreadAgentControl({
  thread,
  provider,
  childCount,
  activeChildren,
  expanded,
  staleWorking,
  staleWorkingMinutes,
  onToggle,
}: {
  thread: PluginSidebarThread;
  provider?: ThreadProvider;
  childCount: number;
  activeChildren: number;
  expanded: boolean;
  staleWorking: boolean;
  staleWorkingMinutes: number;
  onToggle(): void;
}) {
  const childLabel =
    childCount === 0
      ? "No child agents"
      : `${childCount} child agent${childCount === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className={`ws-thread-agent-control ${expanded ? "ws-thread-agent-control-expanded" : ""}`}
      data-empty={childCount === 0 ? "true" : undefined}
      aria-label={`${childLabel}${expanded ? ", expanded" : ", collapsed"}`}
      aria-expanded={expanded}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onToggle();
      }}
    >
      <ThreadRuntimeProvider
        thread={thread}
        provider={provider}
        activeChildren={activeChildren}
        staleWorking={staleWorking}
        staleWorkingMinutes={staleWorkingMinutes}
      />
      <small
        aria-hidden
        data-saturated={childCount > 99 ? "true" : undefined}
      >
        {childCount > 0 ? childAgentCountDisplay(childCount) : null}
      </small>
    </button>
  );
}
