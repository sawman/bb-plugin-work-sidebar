import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { ThreadProviderRuntimeState } from "@/components/threads/thread-provider-logo";
import {
  adaptSidebarThreadActivity,
  threadActivityProviderState,
} from "@/shared/thread-activity";

export function threadProviderRuntimeState(
  thread: PluginSidebarThread,
  staleWorking: boolean,
  activeChildren: number,
): ThreadProviderRuntimeState {
  const state = threadActivityProviderState(
    adaptSidebarThreadActivity(thread, {
      activeChildCount: activeChildren,
      stale: staleWorking,
    }),
  );
  return state;
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
  const ownActivity = adaptSidebarThreadActivity(thread).ownWorking
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
