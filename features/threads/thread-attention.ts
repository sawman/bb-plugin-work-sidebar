import { useEffect, useReducer } from "react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

import { normalizeIndicator } from "@/work-model";

export const STALE_WORKING_MS = 30 * 60 * 1_000;

export function threadNeedsAttention(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return (
    thread.hasPendingInteraction ||
    indicator === "waiting-for-input" ||
    indicator === "unread-error" ||
    indicator === "unread-success"
  );
}

export function threadIsWorking(thread: PluginSidebarThread): boolean {
  const indicator = normalizeIndicator(String(thread.indicator));
  return (
    indicator === "runtime" ||
    indicator === "workflow" ||
    indicator === "background-agent" ||
    indicator === "background-command" ||
    indicator === "goal" ||
    indicator === "plan-mode" ||
    indicator === "working-draft"
  );
}

function lastThreadUpdateAt(thread: PluginSidebarThread): number {
  return Math.max(
    thread.createdAt || 0,
    thread.updatedAt || 0,
    thread.latestAttentionAt || 0,
  );
}

export function useStaleWorking(thread: PluginSidebarThread): boolean {
  const [, refreshClock] = useReducer((revision: number) => revision + 1, 0);
  const working = threadIsWorking(thread);
  const lastUpdateAt = lastThreadUpdateAt(thread);
  const remaining = lastUpdateAt + STALE_WORKING_MS - Date.now();
  const stale = working && lastUpdateAt > 0 && remaining <= 0;

  useEffect(() => {
    if (!working || lastUpdateAt <= 0 || remaining <= 0) return;
    const timer = window.setTimeout(refreshClock, remaining);
    return () => window.clearTimeout(timer);
  }, [lastUpdateAt, remaining, working]);

  return stale;
}
