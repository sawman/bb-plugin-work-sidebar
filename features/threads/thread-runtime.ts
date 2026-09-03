import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadProviderRuntimeState } from "@/components/threads/thread-provider-logo";
import { normalizeIndicator } from "@/work-model";
import { threadIsWorking } from "./thread-attention";

export function threadProviderRuntimeState(
  thread: PluginSidebarThread,
  staleWorking: boolean,
  activeChildren: number,
): ThreadProviderRuntimeState {
  if (normalizeIndicator(String(thread.indicator)) === "unread-error")
    return "error";
  if (normalizeIndicator(String(thread.indicator)) === "waiting-for-input")
    return "waiting";
  if (normalizeIndicator(String(thread.indicator)) === "unread-success")
    return "complete";
  if (threadIsWorking(thread) || activeChildren > 0) return "working";
  if (staleWorking) return "stale";
  return "idle";
}

export function threadProviderStatusLabel(
  thread: PluginSidebarThread,
  staleWorking: boolean,
  activeChildren: number,
  runtimeState: ThreadProviderRuntimeState,
  staleWorkingMinutes: number,
): string | null {
  if (runtimeState === "error") return thread.indicatorLabel ?? "Thread failed";
  if (runtimeState === "waiting") return "Waiting for input";
  if (runtimeState === "complete") return "Thread completed";
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
  return null;
}
