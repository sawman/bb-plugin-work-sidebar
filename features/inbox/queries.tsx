import {
  type InfiniteData,
  useMutation,
  useInfiniteQuery,
  useMutationState,
  useQueryClient,
  type QueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRpc, useRealtime } from "@get-bb/plugin-sdk/app";
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

export const inboxOptimisticMutationKey = (threadId: string) => ["work-sidebar", "inbox", threadId, "optimistic"] as const;
const inboxMutationKey = (threadId: string, action: "acknowledge" | "bookmark") => [
  ...inboxOptimisticMutationKey(threadId),
  action,
] as const;
type DeferredInvalidation = { pending: boolean; invalidating: boolean };
type DeferredClientState = {
  threads: Map<string, DeferredInvalidation>;
  unsubscribe: (() => void) | null;
};

// State is scoped to a QueryClient (one app-window generation) and discarded
// as soon as a thread has no deferred work. The mutation-cache subscription is
// necessary because an async onSettled callback is itself still mutating until
// it returns; its final idle transition is the safe point to refetch.
const deferredInvalidations = new WeakMap<QueryClient, DeferredClientState>();

function normalizedQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function hasInboxMutation(queryClient: QueryClient, threadId: string) {
  return queryClient.isMutating({ mutationKey: inboxOptimisticMutationKey(threadId) }) > 0;
}

function clientState(queryClient: QueryClient) {
  let state = deferredInvalidations.get(queryClient);
  if (!state) {
    state = { threads: new Map(), unsubscribe: null };
    deferredInvalidations.set(queryClient, state);
  }
  return state;
}

function cleanupDeferredState(queryClient: QueryClient, threadId: string) {
  const state = deferredInvalidations.get(queryClient);
  const thread = state?.threads.get(threadId);
  if (!state || !thread || thread.pending || thread.invalidating || hasInboxMutation(queryClient, threadId)) return;
  state.threads.delete(threadId);
  if (state.threads.size) return;
  state.unsubscribe?.();
  deferredInvalidations.delete(queryClient);
}

function flushDeferredInvalidation(queryClient: QueryClient, threadId: string) {
  const state = deferredInvalidations.get(queryClient);
  const thread = state?.threads.get(threadId);
  if (!thread || thread.invalidating || hasInboxMutation(queryClient, threadId)) return;
  if (!thread.pending) {
    cleanupDeferredState(queryClient, threadId);
    return;
  }
  thread.pending = false;
  thread.invalidating = true;
  void queryClient.invalidateQueries({ queryKey: queryKeys.inbox.thread(threadId) }).finally(() => {
    thread.invalidating = false;
    flushDeferredInvalidation(queryClient, threadId);
  });
}

function deferInboxInvalidation(queryClient: QueryClient, threadId: string) {
  const state = clientState(queryClient);
  let thread = state.threads.get(threadId);
  if (!thread) {
    thread = { pending: false, invalidating: false };
    state.threads.set(threadId, thread);
  }
  thread.pending = true;
  if (!state.unsubscribe) {
    state.unsubscribe = queryClient.getMutationCache().subscribe(() => {
      for (const currentThreadId of state.threads.keys())
        flushDeferredInvalidation(queryClient, currentThreadId);
    });
  }
  flushDeferredInvalidation(queryClient, threadId);
}

/** Coalesce realtime and mutation-settled refreshes until the final mutation is idle. */
export function invalidateInbox(queryClient: QueryClient, threadId: string) {
  deferInboxInvalidation(queryClient, threadId);
  return Promise.resolve();
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
  const queryResult = useInfiniteQuery({
    queryKey: queryKeys.inbox.scope(threadId, normalized),
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => rpc.call(
      "listHumanMessages",
      {
        threadId,
        ...(normalized ? { query: normalized } : {}),
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      },
    ) as Promise<InboxPage>,
    getNextPageParam: (lastPage) => lastPage?.cursor ?? undefined,
    ...queryPolicies.inbox,
    refetchOnMount: "always" as const,
    refetchInterval: false as const,
  });
  // A refetch starts with page one, then derives subsequent cursors from the
  // refreshed predecessor; stale cursor keys cannot survive this boundary.
  const pages = (queryResult.data?.pages ?? []).filter((page): page is InboxPage => Boolean(page));
  const lastPage = pages.at(-1);
  const data = pages.length
    ? {
        messages: pages.flatMap((page) => page.messages),
        cursor: lastPage?.cursor ?? null,
        activeCount: lastPage?.activeCount ?? 0,
        savedCount: lastPage?.savedCount ?? 0,
      }
    : undefined;
  return {
    data,
    error: queryResult.error,
    isPending: queryResult.isPending,
    isInitialPending: !data && queryResult.isPending,
    isFetching: queryResult.isFetching,
    isFetchingNextPage: queryResult.isFetchingNextPage,
    isFetchNextPageError: queryResult.isFetchNextPageError,
    hasNextPage: queryResult.hasNextPage,
    fetchNextPage: () => void queryResult.fetchNextPage(),
    refetch: queryResult.refetch,
    retryFailedPage: () => void queryResult.fetchNextPage(),
  };
}

type InboxData = InfiniteData<InboxPage, string | null>;
type Snapshot = readonly [QueryKey, InboxData | undefined][];

function updateCachedMessages(
  queryClient: QueryClient,
  threadId: string,
  update: (message: HumanMessage) => HumanMessage,
) {
  const snapshots: Snapshot = queryClient
    .getQueriesData<InboxData>({ queryKey: queryKeys.inbox.thread(threadId) })
    .map(([key, page]) => [key, page]);
  for (const [key, data] of snapshots) {
    if (!data) continue;
    let activeDelta = 0;
    let savedDelta = 0;
    const changedIds = new Set<string>();
    const pages = data.pages.map((page) => ({
      ...page,
      messages: page.messages.map((message) => {
        const next = update(message);
        if (next === message || changedIds.has(message.id)) return next;
        changedIds.add(message.id);
        activeDelta += Number(next.acknowledgedAt === null) - Number(message.acknowledgedAt === null);
        savedDelta += Number(next.acknowledgedAt !== null && next.bookmarkedAt !== null)
          - Number(message.acknowledgedAt !== null && message.bookmarkedAt !== null);
        return next;
      }),
    }));
    queryClient.setQueryData<InboxData>(key, {
      ...data,
      pages: pages.map((page) => ({
        ...page,
        activeCount: Math.max(0, page.activeCount + activeDelta),
        savedCount: Math.max(0, page.savedCount + savedDelta),
      })),
    });
  }
  return snapshots;
}

type InboxMutationVariables = { messageId: string };

/** Mutation-cache projection keeps busy/error state tied to a row, even when
 * another row starts the same action before the first settles. */
export function useInboxMessageMutationState(threadId: string, messageId: string) {
  const states = useMutationState({
    filters: { mutationKey: inboxOptimisticMutationKey(threadId) },
    select: (mutation) => ({ ...mutation.state, mutationId: mutation.mutationId }),
  });
  const matching = states.filter((state) => (state.variables as InboxMutationVariables | undefined)?.messageId === messageId);
  const latest = [...matching].sort((left, right) =>
    right.submittedAt - left.submittedAt || right.mutationId - left.mutationId,
  )[0];
  return {
    busy: matching.some((state) => state.status === "pending"),
    error: latest?.status === "error" ? latest.error : null,
  };
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
    mutationKey: inboxMutationKey(threadId, "acknowledge"),
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
    mutationKey: inboxMutationKey(threadId, "bookmark"),
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
