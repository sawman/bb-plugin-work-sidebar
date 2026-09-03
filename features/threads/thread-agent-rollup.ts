import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { threadIsWorking } from "./thread-attention";

export type ThreadAgentRollup = {
  childCount: number;
  activeChildCount: number;
};

/** Counts every descendant once for compact parent-row child-agent rollups. */
export function threadAgentRollups(
  roots: readonly PluginSidebarThread[],
  childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): ReadonlyMap<string, ThreadAgentRollup> {
  const rollups = new Map<string, ThreadAgentRollup>();
  const visiting = new Set<string>();
  const visit = (thread: PluginSidebarThread): ThreadAgentRollup => {
    const cached = rollups.get(thread.id);
    if (cached) return cached;
    if (visiting.has(thread.id)) return { childCount: 0, activeChildCount: 0 };
    visiting.add(thread.id);
    let childCount = 0;
    let activeChildCount = 0;
    for (const child of childrenByThread.get(thread.id) ?? []) {
      const childRollup = visit(child);
      childCount += 1 + childRollup.childCount;
      activeChildCount +=
        (threadIsWorking(child) ? 1 : 0) + childRollup.activeChildCount;
    }
    visiting.delete(thread.id);
    const rollup = { childCount, activeChildCount };
    rollups.set(thread.id, rollup);
    return rollup;
  };
  for (const root of roots) visit(root);
  return rollups;
}
