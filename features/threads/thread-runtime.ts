import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadProviderRuntimeState } from "@/components/threads/thread-provider-logo";
import { normalizeIndicator } from "@/work-model";
import { threadIsWorking } from "./thread-attention";

export function threadProviderRuntimeState(
  thread: PluginSidebarThread,
  staleWorking: boolean,
  activeChildren: number,
): ThreadProviderRuntimeState {
  if (threadIsWorking(thread) || activeChildren > 0) return "working";
  if (staleWorking) return "stale";
  switch (normalizeIndicator(String(thread.indicator))) {
    case "waiting-for-input":
      return "waiting";
    case "unread-error":
      return "error";
    case "unread-success":
      return "complete";
    default:
      return "idle";
  }
}

export function threadProviderStatusLabel(
  thread: PluginSidebarThread,
  staleWorking: boolean,
  activeChildren: number,
  runtimeState: ThreadProviderRuntimeState,
  staleWorkingMinutes: number,
): string | null {
  const childActivity = activeChildren
    ? `${activeChildren} child agent${activeChildren === 1 ? "" : "s"} working`
    : null;
  const ownActivity = threadIsWorking(thread)
    ? (thread.indicatorLabel ?? "Thread is working")
    : null;
  const activity =
    ownActivity && childActivity
      ? `${ownActivity}; ${childActivity}`
      : (ownActivity ?? childActivity);
  if (staleWorking)
    return `${activity ?? "Thread is working"}; no agent update for ${staleWorkingMinutes} minutes`;
  if (activity || thread.indicatorLabel)
    return activity ?? thread.indicatorLabel;
  if (runtimeState === "waiting") return "Waiting for input";
  if (runtimeState === "error") return "Thread failed";
  if (runtimeState === "complete") return "Thread completed";
  return null;
}
