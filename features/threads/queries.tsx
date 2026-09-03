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
  normalizeThreadGroupDisclosures,
  type SidebarThreadGroup,
  type SidebarThreadGroupPreferences,
} from "./model";
import type { WorkingProviderAnimation } from "./sidebar-appearance";
import type { GroupActivityPriority } from "./group-activity-priority";
import { invalidateTaskQueries } from "../tasks/mutations";
import { invalidateTracker } from "../tracker/queries";
import { invalidateWorkContextCards } from "../work-context/queries";
import type { RecycleBinEntry } from "./recycle-bin";

const root = ["work-sidebar", "sidebar", "threads"] as const;
export const threadQueryKeys = {
  root,
  order: () => [...root, "order"] as const,
  groups: () => [...root, "groups"] as const,
  appearance: () => [...root, "appearance"] as const,
  queuedMessages: () => [...root, "queued-messages"] as const,
  archived: () => [...root, "archived"] as const,
  recycleBin: () => [...root, "recycle-bin"] as const,
} as const;
export const threadQueryPolicies = {
  order: queryPolicies.sidebarOrderPreferences,
  groups: queryPolicies.sidebarOrderPreferences,
  appearance: queryPolicies.sidebarOrderPreferences,
  queuedMessages: queryPolicies.queuedMessages,
} as const;
export type ThreadsRpc = PluginRpcClient<typeof rpcContract>;
export type SidebarAppearance = {
  rowHeight: number;
  textScale: number;
  workingProviderAnimation?: WorkingProviderAnimation;
  groupActivityPriority?: GroupActivityPriority;
};
export type SidebarAppearanceUpdate =
  | { rowHeight: number }
  | { textScale: number }
  | { workingProviderAnimation: WorkingProviderAnimation }
  | { groupActivityPriority: GroupActivityPriority };

export function useThreadHierarchyMutation(rpc: ThreadsRpc) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { threadId: string; parentThreadId: string | null }) =>
      rpc.call("moveSidebarThread", input),
    onSuccess: async (result) => {
      await client.invalidateQueries({ queryKey: threadQueryKeys.root });
      await Promise.all(
        result.affectedThreadIds.flatMap((threadId) => [
          invalidateWorkContextCards(client, threadId),
          invalidateTracker(client, threadId),
        ]),
      );
      await invalidateTaskQueries(client, ["list", "links"]);
    },
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

export async function saveSidebarAppearance(
  client: QueryClient,
  rpc: ThreadsRpc,
  update: SidebarAppearanceUpdate,
) {
  const result = await rpc.call("saveSidebarAppearance", update);
  client.setQueryData(threadQueryKeys.appearance(), result);
  return result;
}

function useSaveSidebarAppearance(
  rpc: ThreadsRpc,
  client: QueryClient,
  field:
    | "rowHeight"
    | "textScale"
    | "workingProviderAnimation"
    | "groupActivityPriority",
) {
  return useMutation({
    mutationFn: (
      value: number | WorkingProviderAnimation | GroupActivityPriority,
    ) =>
      saveSidebarAppearance(
        client,
        rpc,
        field === "rowHeight"
          ? { rowHeight: value as number }
          : field === "textScale"
          ? { textScale: value as number }
            : field === "workingProviderAnimation"
              ? {
                  workingProviderAnimation:
                    value as WorkingProviderAnimation,
                }
              : { groupActivityPriority: value as GroupActivityPriority },
      ),
  });
}

export function useSidebarAppearancePreferences() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const appearance = useQuery(sidebarAppearanceQuery(rpc));
  const saveRowHeight = useSaveSidebarAppearance(rpc, client, "rowHeight");
  const saveTextScale = useSaveSidebarAppearance(rpc, client, "textScale");
  const saveWorkingProviderAnimation = useSaveSidebarAppearance(
    rpc,
    client,
    "workingProviderAnimation",
  );
  const saveGroupActivityPriority = useSaveSidebarAppearance(
    rpc,
    client,
    "groupActivityPriority",
  );
  return {
    appearance,
    saveRowHeight,
    saveTextScale,
    saveWorkingProviderAnimation,
    saveGroupActivityPriority,
  };
}

export async function saveThreadGroups(
  client: QueryClient,
  rpc: ThreadsRpc,
  groups: SidebarThreadGroup[],
  activeGroupPosition = 0,
  disclosures: Record<string, boolean> = {},
) {
  const result = await rpc.call("saveThreadGroups", {
    groups,
    activeGroupPosition,
    ...(Object.keys(disclosures).length ? { disclosures } : {}),
  });
  const preferences: SidebarThreadGroupPreferences = {
    groups: result.groups as SidebarThreadGroup[],
    activeGroupPosition: normalizeActiveGroupPosition(
      result.activeGroupPosition ?? activeGroupPosition,
      result.groups.length,
    ),
    disclosures: normalizeThreadGroupDisclosures(result.disclosures ?? disclosures),
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
        disclosures: normalizeThreadGroupDisclosures(result.disclosures),
      } satisfies SidebarThreadGroupPreferences;
    },
    ...threadQueryPolicies.groups,
  });
  const appearancePreferences = useSidebarAppearancePreferences();
  const appearance = appearancePreferences.appearance;
  const saveRowHeight = appearancePreferences.saveRowHeight;
  const saveTextScale = appearancePreferences.saveTextScale;
  const saveWorkingProviderAnimation =
    appearancePreferences.saveWorkingProviderAnimation;
  const saveGroupActivityPriority =
    appearancePreferences.saveGroupActivityPriority;
  useRealtime("sidebar-order:changed", () => {
    for (const key of [
      threadQueryKeys.order(),
      threadQueryKeys.groups(),
      threadQueryKeys.appearance(),
      threadQueryKeys.archived(),
      threadQueryKeys.recycleBin(),
    ]) {
      void client.invalidateQueries({ queryKey: key });
    }
  });
  const saveGroups = useMutation({
    mutationFn: (next: SidebarThreadGroupPreferences) =>
      saveThreadGroups(
        client,
        rpc,
        next.groups,
        next.activeGroupPosition,
        next.disclosures ?? {},
      ),
  });
  const saveOrder = useMutation({
    mutationFn: async (threadIds: string[]) => {
      const result = await rpc.call("saveSiblingOrder", { threadIds });
      client.setQueryData(threadQueryKeys.order(), result.threadIds);
      return result.threadIds;
    },
  });
  return {
    order,
    groups,
    appearance,
    saveRowHeight,
    saveTextScale,
    saveWorkingProviderAnimation,
    saveGroupActivityPriority,
    saveGroups,
    saveOrder,
  };
}

/** A single Work-tab observer reads durable queue rows; event ownership stays
 * in the sidebar controller so remounting a row can never add listeners. */
export const QUEUED_MESSAGE_REFRESH_MS = 2_000;

export function useQueuedMessagesQuery(rpc: ThreadsRpc, active: boolean) {
  return useQuery({
    queryKey: threadQueryKeys.queuedMessages(),
    queryFn: async () => (await rpc.call("sidebarQueuedMessages", null)).messages,
    ...threadQueryPolicies.queuedMessages,
    refetchInterval: active ? QUEUED_MESSAGE_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    enabled: active,
  });
}

export function useQueuedMessages(active: boolean) {
  return useQueuedMessagesQuery(useRpc<typeof rpcContract>(), active);
}

export function useQueuedMessageInvalidation() {
  const client = useQueryClient();
  useRealtime("work-sidebar:changed", (payload) => {
    if (
      typeof payload === "object" &&
      payload !== null &&
      "family" in payload &&
      payload.family === "queued-message"
    )
      void client.invalidateQueries({
        queryKey: threadQueryKeys.queuedMessages(),
      });
  });
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

/** Reversible plugin-owned filing. This deliberately never invokes host archive. */
export function useRecycleBin() {
  const rpc = useRpc<typeof rpcContract>();
  const client = useQueryClient();
  const bin = useQuery({
    queryKey: threadQueryKeys.recycleBin(),
    queryFn: async () =>
      (await rpc.call("getRecycleBin", null)).entries as RecycleBinEntry[],
    ...threadQueryPolicies.groups,
  });
  const binThread = useMutation({
    mutationFn: (input: { threadId: string; originGroupId: string | null }) =>
      rpc.call("binSidebarThread", input),
    onSuccess: (result) =>
      client.setQueryData(threadQueryKeys.recycleBin(), result.entries),
  });
  const restore = useMutation({
    mutationFn: (input: { threadId: string; groupIds: string[] }) =>
      rpc.call("restoreBinnedSidebarThread", input),
    onSuccess: (result) =>
      client.setQueryData(threadQueryKeys.recycleBin(), result.entries),
  });
  return { bin, binThread, restore };
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
