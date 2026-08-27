import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";

/** Return visible tree ids in depth-first order for selection and group moves. */
export function visibleThreadTreeIds(
  roots: readonly PluginSidebarThread[],
  childrenByThread: ReadonlyMap<string, readonly PluginSidebarThread[]>,
): string[] {
  const ids: string[] = [];
  const visit = (thread: PluginSidebarThread) => {
    ids.push(thread.id);
    for (const child of childrenByThread.get(thread.id) ?? []) visit(child);
  };
  for (const root of roots) visit(root);
  return ids;
}
