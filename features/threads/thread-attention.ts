import { useEffect, useReducer } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { normalizeIndicator } from "@/work-model";
import {
  DEFAULT_GROUP_ACTIVITY_PRIORITY,
  prioritizeGroupActivity,
  type GroupActivityPriority,
  type ThreadGroupActivity,
} from "./group-activity-priority";

export const DEFAULT_STALE_WORKING_MINUTES = 30;
export const STALE_WORKING_MS = DEFAULT_STALE_WORKING_MINUTES * 60 * 1_000;
export type { ThreadGroupActivity } from "./group-activity-priority";

export function threadGroupActivity(
  thread: PluginSidebarThread,
): ThreadGroupActivity | null {
  const indicator = normalizeIndicator(String(thread.indicator));
  if (indicator === "unread-error") return "error";
  if (thread.hasPendingInteraction || indicator === "waiting-for-input") {
    return "attention";
  }
  if (indicator === "unread-success") return "completed";
  return threadIsWorking(thread) ? "working" : null;
}

export function threadNeedsAttention(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return (
    thread.hasPendingInteraction ||
    indicator === "waiting-for-input" ||
    indicator === "unread-error" ||
    indicator === "unread-success"
  );
}

/** A group is actionable when any visible root or descendant is actionable. */
export function threadTreeNeedsAttention(
  roots: readonly PluginSidebarThread[],
  childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): boolean {
  const activity = threadTreeGroupActivity(roots, childrenByThread);
  return activity === "error" || activity === "attention" || activity === "completed";
}

/**
 * Collapses visible thread activity to one header marker. The most urgent
 * state wins: error, user attention, completion, then routine work.
 */
export function threadTreeGroupActivity(
  roots: readonly PluginSidebarThread[],
  childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>,
  priority: GroupActivityPriority = DEFAULT_GROUP_ACTIVITY_PRIORITY,
): ThreadGroupActivity | null {
  const pending = [...roots];
  const visited = new Set<string>();
  let activity: ThreadGroupActivity | null = null;
  while (pending.length > 0) {
    const thread = pending.pop();
    if (!thread || visited.has(thread.id)) continue;
    visited.add(thread.id);
    const candidate = threadGroupActivity(thread);
    activity = prioritizeGroupActivity(activity, candidate, priority);
    pending.push(...(childrenByThread.get(thread.id) ?? []));
  }
  return activity;
}

export function threadIsWorking(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return (
    Object.values(thread.activity ?? {}).some((count) => count > 0) ||
    indicator === "runtime" ||
    indicator === "workflow" ||
    indicator === "background-agent" ||
    indicator === "background-command" ||
    indicator === "goal" ||
    indicator === "plan-mode" ||
    indicator === "working-draft"
  );
}

export function threadReportsComposerDraft(
  thread: PluginSidebarThread,
): boolean {
  // SDK 0.4.28+ supplies the durable signal. Older hosts retain only their
  // historical row indicator values; never infer a row from the mounted
  // composer, which is selection-dependent client state.
  if ("hasComposerDraft" in thread) {
    return thread.hasComposerDraft === true;
  }
  const indicator = normalizeIndicator(String(thread.indicator));
  return indicator === "draft" || indicator === "working-draft";
}

function lastThreadUpdateAt(thread: PluginSidebarThread): number {
  return Math.max(
    thread.createdAt || 0,
    thread.updatedAt || 0,
    thread.latestAttentionAt || 0,
  );
}

export function useStaleWorking(
  thread: PluginSidebarThread,
  staleWorkingMinutes = DEFAULT_STALE_WORKING_MINUTES,
): boolean {
  const [, refreshClock] = useReducer((revision: number) => revision + 1, 0);
  const working = threadIsWorking(thread);
  const lastUpdateAt = lastThreadUpdateAt(thread);
  const remaining =
    lastUpdateAt + staleWorkingMinutes * 60 * 1_000 - Date.now();
  const stale = working && lastUpdateAt > 0 && remaining <= 0;

  useEffect(() => {
    if (!working || lastUpdateAt <= 0 || remaining <= 0) return;
    const timer = window.setTimeout(refreshClock, remaining);
    return () => window.clearTimeout(timer);
  }, [lastUpdateAt, remaining, working]);

  return stale;
}
