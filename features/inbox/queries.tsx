import {
  useMutation,
  useQueries,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
import { useState } from "react";
import type { rpcContract } from "../../contracts";
import type { HumanMessage } from "./schemas";
import { queryKeys, queryPolicies } from "../../query-runtime";
import { parseWorkSidebarRealtimeEvent } from "../../shared/work-realtime";

export type InboxPage = Readonly<{
  messages: readonly HumanMessage[];
  cursor: string | null;
  activeCount: number;
  savedCount: number;
}>;

function normalizedQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function pageQuery(
  rpc: ReturnType<typeof useRpc<typeof rpcContract>>,
  threadId: string,
  query: string,
  cursor: string | null,
) {
  return {
    queryKey: queryKeys.inbox.page(threadId, query, cursor),
    queryFn: () => rpc.call(
      "listHumanMessages",
      {
        threadId,
        ...(query ? { query } : {}),
        limit: 50,
        ...(cursor ? { cursor } : {}),
      },
    ) as Promise<InboxPage>,
    ...queryPolicies.inbox,
    refetchOnMount: "always" as const,
    refetchInterval: false as const,
  };
}

export function invalidateInbox(queryClient: QueryClient, threadId: string) {
  return queryClient.invalidateQueries({ queryKey: queryKeys.inbox.thread(threadId) });
}

export function useInboxRealtime(threadId: string) {
  const queryClient = useQueryClient();
  useRealtime("work-sidebar:changed", (payload) => {
    const event = parseWorkSidebarRealtimeEvent(payload);
    if (event?.family === "inbox" && event.threadId === threadId)
      void invalidateInbox(queryClient, threadId);
  });
}

export function useInboxMessages(threadId: string, query: string) {
  const rpc = useRpc<typeof rpcContract>();
  useInboxRealtime(threadId);
  const normalized = normalizedQuery(query);
  const scopeKey = `${threadId}\u0000${normalized}`;
  const [pagination, setPagination] = useState<{
    scopeKey: string;
    cursors: readonly (string | null)[];
  }>({ scopeKey, cursors: [null] });
  // Reset during render so a thread/search transition never mounts a query
  // with the previous scope's cursor for one frame.
  if (pagination.scopeKey !== scopeKey)
    setPagination({ scopeKey, cursors: [null] });
  const cursors = pagination.scopeKey === scopeKey ? pagination.cursors : [null];
  const cursorKey = cursors.join("\u0000");
  const queries = useQueries({
    queries: cursors.map((cursor) => pageQuery(rpc, threadId, normalized, cursor)),
  });
  const pages = queries.map((queryResult) => queryResult.data).filter((page): page is InboxPage => Boolean(page));
  const lastPage = pages.at(-1);
  const data = pages.length
    ? {
        messages: pages.flatMap((page) => page.messages),
        cursor: lastPage?.cursor ?? null,
        activeCount: lastPage?.activeCount ?? 0,
        savedCount: lastPage?.savedCount ?? 0,
      }
    : undefined;
  const pending = queries.some((queryResult) => queryResult.isPending);
  const error = queries.find((queryResult) => queryResult.error)?.error ?? null;
  const fetching = queries.some((queryResult) => queryResult.isFetching);
  return {
    data,
    error,
    isPending: pending,
    isFetching: fetching,
    hasNextPage: Boolean(lastPage?.cursor),
    fetchNextPage: () => {
      if (lastPage?.cursor && !cursors.includes(lastPage.cursor))
        setPagination((current) => ({ ...current, cursors: [...current.cursors, lastPage.cursor!] }));
    },
    refetch: () => Promise.all(queries.map((query) => query.refetch())),
    cursorKey,
  };
}

type Snapshot = readonly [QueryKey, InboxPage | undefined][];

function updateCachedMessages(
  queryClient: QueryClient,
  threadId: string,
  update: (message: HumanMessage) => HumanMessage,
) {
  const snapshots: Snapshot = queryClient
    .getQueriesData<InboxPage>({ queryKey: queryKeys.inbox.thread(threadId) })
    .map(([key, page]) => [key, page]);
  const scopeDeltas = new Map<string, { active: number; saved: number }>();
  const updatedPages = snapshots.map(([key, page]) => {
    if (!page) return [key, page] as const;
    const previousById = new Map(page.messages.map((message) => [message.id, message]));
    const messages = page.messages.map(update);
    const delta = scopeDeltas.get(key.slice(0, -1).join("\u0000")) ?? { active: 0, saved: 0 };
    for (const message of messages) {
      const previous = previousById.get(message.id);
      delta.active += (previous?.acknowledgedAt === null ? -1 : 0) + (message.acknowledgedAt === null ? 1 : 0);
      const before = previous?.acknowledgedAt !== null && previous?.bookmarkedAt !== null;
      const after = message.acknowledgedAt !== null && message.bookmarkedAt !== null;
      delta.saved += (after ? 1 : 0) - (before ? 1 : 0);
    }
    scopeDeltas.set(key.slice(0, -1).join("\u0000"), delta);
    return [key, { ...page, messages }] as const;
  });
  for (const [key, page] of updatedPages) {
    if (!page) continue;
    const delta = scopeDeltas.get(key.slice(0, -1).join("\u0000")) ?? { active: 0, saved: 0 };
    queryClient.setQueryData<InboxPage>(key, {
      ...page,
      activeCount: Math.max(0, page.activeCount + delta.active),
      savedCount: Math.max(0, page.savedCount + delta.saved),
    });
  }
  return snapshots;
}

function rollback(queryClient: QueryClient, snapshots: Snapshot) {
  for (const [key, data] of snapshots)
    queryClient.setQueryData(key, data);
}

export function useInboxMutations(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const queryClient = useQueryClient();
  const mutationOptions = {
    onSettled: () => invalidateInbox(queryClient, threadId),
  };
  const acknowledge = useMutation({
    mutationKey: [...queryKeys.inbox.thread(threadId), "acknowledge"],
    mutationFn: ({ messageId, revision }: { messageId: string; revision: number }) =>
      rpc.call("acknowledgeHumanMessage", {
        threadId,
        messageId,
        expectedRevision: revision,
      }) as Promise<HumanMessage>,
    onMutate: async ({ messageId }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.inbox.thread(threadId) });
      const snapshots = updateCachedMessages(queryClient, threadId, (message) =>
        message.id === messageId
          ? { ...message, acknowledgedAt: new Date().toISOString(), revision: message.revision + 1 }
          : message,
      );
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshots) rollback(queryClient, context.snapshots);
    },
    ...mutationOptions,
  });
  const bookmark = useMutation({
    mutationKey: [...queryKeys.inbox.thread(threadId), "bookmark"],
    mutationFn: ({ messageId, bookmarked, revision }: { messageId: string; bookmarked: boolean; revision: number }) =>
      rpc.call("setHumanMessageBookmark", {
        threadId,
        messageId,
        bookmarked,
        expectedRevision: revision,
      }) as Promise<HumanMessage>,
    onMutate: async ({ messageId, bookmarked }) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.inbox.thread(threadId) });
      const snapshots = updateCachedMessages(queryClient, threadId, (message) =>
        message.id === messageId
          ? { ...message, bookmarkedAt: bookmarked ? new Date().toISOString() : null, revision: message.revision + 1 }
          : message,
      );
      return { snapshots };
    },
    onError: (_error, _variables, context) => {
      if (context?.snapshots) rollback(queryClient, context.snapshots);
    },
    ...mutationOptions,
  });
  return { acknowledge, bookmark };
}
