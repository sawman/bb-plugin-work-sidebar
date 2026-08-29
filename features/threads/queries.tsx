import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
} from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import {
  useRealtime,
  useRpc,
  type PluginRpcClient,
} from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { queryPolicies } from "../../query-runtime";
import {
  normalizeActiveGroupPosition,
  type SidebarThreadGroup,
  type SidebarThreadGroupPreferences,
} from "./model";

const root = ["work-sidebar", "sidebar", "threads"] as const;
export const threadQueryKeys = {
  root,
  order: () => [...root, "order"] as const,
  groups: () => [...root, "groups"] as const,
  appearance: () => [...root, "appearance"] as const,
  archived: () => [...root, "archived"] as const,
} as const;
export const threadQueryPolicies = {
  order: queryPolicies.sidebarOrderPreferences,
  groups: queryPolicies.sidebarOrderPreferences,
  appearance: queryPolicies.sidebarOrderPreferences,
} as const;
export type ThreadsRpc = PluginRpcClient<typeof rpcContract>;

export function useThreadHierarchyMutation(rpc: ThreadsRpc) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      threadId: string;
      parentThreadId: string | null;
    }) => rpc.call("moveSidebarThread", input),
    onSuccess: () =>
      client.invalidateQueries({ queryKey: threadQueryKeys.root }),
  });
}

async function readSidebarAppearance(rpc: ThreadsRpc) {
  return rpc.call("getSidebarAppearance", null);
}

function sidebarAppearanceQuery(rpc: ThreadsRpc) {
  return {
    queryKey: threadQueryKeys.appearance(),
    queryFn: () => readSidebarAppearance(rpc),
    ...threadQueryPolicies.appearance,
  } as const;
}

function useSaveSidebarAppearance(rpc: ThreadsRpc, client: QueryClient) {
  return useMutation({
    mutationFn: (rowHeight: number) =>
      rpc.call("saveSidebarAppearance", { rowHeight }),
    onSuccess: (result) => {
      client.setQueryData(threadQueryKeys.appearance(), result);
    },
  });
}

export function useSidebarAppearancePreferences() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const appearance = useQuery(sidebarAppearanceQuery(rpc));
  const saveAppearance = useSaveSidebarAppearance(rpc, client);
  return { appearance, saveAppearance };
}

export async function saveThreadGroups(
  client: QueryClient,
  rpc: ThreadsRpc,
  groups: SidebarThreadGroup[],
  activeGroupPosition = 0,
) {
  const result = await rpc.call("saveThreadGroups", {
    groups,
    activeGroupPosition,
  });
  const preferences: SidebarThreadGroupPreferences = {
    groups: result.groups as SidebarThreadGroup[],
    activeGroupPosition: normalizeActiveGroupPosition(
      result.activeGroupPosition ?? activeGroupPosition,
      result.groups.length,
    ),
  };
  client.setQueryData(threadQueryKeys.groups(), preferences);
  return preferences;
}

export function useThreadPreferences() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const order = useQuery({
    queryKey: threadQueryKeys.order(),
    queryFn: async () => (await rpc.call("getSidebarOrder", null)).threadIds,
    ...threadQueryPolicies.order,
  });
  const groups = useQuery({
    queryKey: threadQueryKeys.groups(),
    queryFn: async () => {
      const result = await rpc.call("getThreadGroups", null);
      return {
        groups: result.groups as SidebarThreadGroup[],
        activeGroupPosition: normalizeActiveGroupPosition(
          result.activeGroupPosition,
          result.groups.length,
        ),
      } satisfies SidebarThreadGroupPreferences;
    },
    ...threadQueryPolicies.groups,
  });
  const appearance = useQuery(sidebarAppearanceQuery(rpc));
  const saveAppearance = useSaveSidebarAppearance(rpc, client);
  useRealtime("sidebar-order:changed", () => {
    void client.invalidateQueries({ queryKey: root });
  });
  const saveGroups = useMutation({
    mutationFn: (next: SidebarThreadGroupPreferences) =>
      saveThreadGroups(client, rpc, next.groups, next.activeGroupPosition),
  });
  const saveOrder = useMutation({
    mutationFn: async (threadIds: string[]) => {
      const result = await rpc.call("saveSiblingOrder", { threadIds });
      client.setQueryData(threadQueryKeys.order(), result.threadIds);
      return result.threadIds;
    },
  });
  return { order, groups, appearance, saveAppearance, saveGroups, saveOrder };
}

export const archivedThreadQueryPolicy = {
  staleTime: 30_000,
  gcTime: 5 * 60_000,
  retry: 1,
  refetchOnMount: true,
  refetchOnWindowFocus: false,
} as const;
export function useArchivedThreadsQuery(
  rpc: ThreadsRpc,
  rosterFingerprint: string,
) {
  const client = useQueryClient();
  const archive = useQuery({
    queryKey: threadQueryKeys.archived(),
    queryFn: async () => {
      const result = await rpc.call("sidebarArchivedThreads", {});
      if (!result.available)
        throw new Error(result.error ?? "Archive threads are unavailable.");
      return result.threads;
    },
    ...archivedThreadQueryPolicy,
  });
  const previousRoster = useRef(rosterFingerprint);
  useEffect(() => {
    if (previousRoster.current !== rosterFingerprint)
      void client.invalidateQueries({ queryKey: threadQueryKeys.archived() });
    previousRoster.current = rosterFingerprint;
  }, [client, rosterFingerprint]);
  const unarchive = useMutation({
    mutationFn: async (threadId: string) => {
      const result = await rpc.call("unarchiveSidebarThread", { threadId });
      await client.invalidateQueries({ queryKey: threadQueryKeys.archived() });
      return result.threadId;
    },
  });
  return { archive, unarchive };
}

export function useArchivedThreads(rosterFingerprint: string) {
  const rpc = useRpc<typeof rpcContract>();
  return useArchivedThreadsQuery(rpc, rosterFingerprint);
}

/** Shared archive action for thread-group drop targets and archive rows. */
export function useUnarchiveSidebarThread() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (threadId: string) => {
      const result = await rpc.call("unarchiveSidebarThread", { threadId });
      await client.invalidateQueries({ queryKey: threadQueryKeys.archived() });
      return result.threadId;
    },
  });
}
