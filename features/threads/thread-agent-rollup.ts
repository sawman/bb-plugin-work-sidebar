import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import {
  adaptSidebarThreadActivity,
  rollupThreadActivityFactDirectory,
} from "@/shared/thread-activity";

export type ThreadAgentRollup = {
  childCount: number;
  activeChildCount: number;
};

/** Counts every descendant once for compact parent-row child-agent rollups. */
export function threadAgentRollups(
  roots: readonly PluginSidebarThread[],
  childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): ReadonlyMap<string, ThreadAgentRollup> {
  const all = new Map<string, PluginSidebarThread>();
  const pending = [...roots];
  while (pending.length > 0) {
    const thread = pending.pop();
    if (!thread || all.has(thread.id)) continue;
    all.set(thread.id, thread);
    pending.push(...(childrenByThread.get(thread.id) ?? []));
  }
  const facts = new Map(
    [...all].map(([id, thread]) => [id, adaptSidebarThreadActivity(thread)]),
  );
  const childIds = new Map(
    [...childrenByThread].map(([id, children]) => [
      id,
      children.map((child) => child.id),
    ]),
  );
  const rollups = new Map<string, ThreadAgentRollup>();
  const activityRollups = rollupThreadActivityFactDirectory(
    all.keys(),
    facts,
    childIds,
  );
  for (const id of all.keys()) {
    const fact = activityRollups.get(id);
    if (!fact) continue;
    rollups.set(id, {
      childCount: fact.childCount,
      activeChildCount: fact.activeChildCount,
    });
  }
  return rollups;
}
