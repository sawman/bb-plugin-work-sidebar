import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { useRealtime, useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";
import type { SidebarThreadGroup } from "./model";

const root = ["work-sidebar", "sidebar", "threads"] as const;
export const threadQueryKeys = {
  order: () => [...root, "order"] as const,
  listMode: () => [...root, "list-mode"] as const,
  groups: () => [...root, "groups"] as const,
  archived: () => [...root, "archived"] as const,
} as const;
export const threadQueryPolicies = { order: queryPolicies.sidebarOrderPreferences, listMode: queryPolicies.sidebarOrderPreferences, groups: queryPolicies.sidebarOrderPreferences } as const;
type Rpc = { call(method: string, input: unknown): Promise<any> };

export async function saveThreadGroups(client: QueryClient, rpc: Rpc, groups: SidebarThreadGroup[]) {
  const result = await rpc.call("saveThreadGroups", { groups });
  client.setQueryData(threadQueryKeys.groups(), result.groups);
  return result.groups as SidebarThreadGroup[];
}

async function savePreference<T>(client: QueryClient, rpc: Rpc, key: readonly string[], method: string, input: unknown, field: string): Promise<T> {
  const result = await rpc.call(method, input) as Record<string, T>;
  client.setQueryData(key, result[field]);
  return result[field]!;
}

export function useThreadPreferences() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const order = useQuery({ queryKey: threadQueryKeys.order(), queryFn: async () => (await rpc.call("getSidebarOrder", null)).threadIds, ...threadQueryPolicies.order });
  const listMode = useQuery({ queryKey: threadQueryKeys.listMode(), queryFn: async () => (await rpc.call("getThreadListMode", null)).mode, ...threadQueryPolicies.listMode });
  const groups = useQuery({ queryKey: threadQueryKeys.groups(), queryFn: async () => (await rpc.call("getThreadGroups", null)).groups, ...threadQueryPolicies.groups });
  useRealtime("sidebar-order:changed", () => { void client.invalidateQueries({ queryKey: root }); });
  const saveGroups = useMutation({ mutationFn: (next: SidebarThreadGroup[]) => saveThreadGroups(client, rpc, next) });
  const saveOrder = useMutation({ mutationFn: (threadIds: string[]) => savePreference<string[]>(client, rpc, threadQueryKeys.order(), "saveSiblingOrder", { threadIds }, "threadIds") });
  const saveListMode = useMutation({ mutationFn: (mode: "enhanced" | "native") => savePreference<"enhanced" | "native">(client, rpc, threadQueryKeys.listMode(), "saveThreadListMode", { mode }, "mode") });
  return { order, listMode, groups, saveGroups, saveOrder, saveListMode };
}

export function useArchivedThreads() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const archive = useQuery({
    queryKey: threadQueryKeys.archived(),
    queryFn: async () => {
      const result = await rpc.call("sidebarArchivedThreads", {});
      if (!result.available) throw new Error(result.error ?? "Archive threads are unavailable.");
      return result.threads;
    },
    ...threadQueryPolicies.groups,
    enabled: false,
  });
  const unarchive = useMutation({ mutationFn: async (threadId: string) => {
    const result = await rpc.call("unarchiveSidebarThread", { threadId });
    await client.invalidateQueries({ queryKey: threadQueryKeys.archived() });
    return result.threadId;
  } });
  return { archive, unarchive };
}
