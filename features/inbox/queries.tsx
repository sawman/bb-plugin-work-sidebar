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
  historyCount: number;
}>;

export const inboxOptimisticMutationKey = (threadId: string) => ["work-sidebar", "inbox", threadId, "optimistic"] as const;
const inboxMutationKey = (threadId: string, action: "acknowledge" | "bookmark") => [
  ...inboxOptimisticMutationKey(threadId),
  action,
] as const;
type InboxScope = {
  query: import("@tanstack/react-query").Query;
  threadId: string;
  pending: boolean;
  refreshing: boolean;
};
type InboxCoordinator = {
  scopes: Map<string, InboxScope>;
  scheduled: boolean;
  dispose: () => void;
};

// Query identity owns refresh progress; only optimistic writes are thread-wide.
// One transient coordinator per client owns both subscriptions and releases them
// when the last scope settles, disappears, or loses its active observer.
const inboxCoordinators = new WeakMap<QueryClient, InboxCoordinator>();

function normalizedQuery(query: string) {
  return query.trim().replace(/\s+/g, " ");
}

function hasInboxMutation(queryClient: QueryClient, threadId: string) {
  return queryClient.isMutating({ mutationKey: inboxOptimisticMutationKey(threadId) }) > 0;
}

function scheduleInboxFlush(client: QueryClient, state: InboxCoordinator) {
  if (state.scheduled || inboxCoordinators.get(client) !== state) return;
  state.scheduled = true;
  // Batch the signal burst, including duplicate consumers in the same window.
  // Cache notifications only wake existing work; they never create more work.
  queueMicrotask(() => {
    state.scheduled = false;
    if (inboxCoordinators.get(client) !== state) return;
    for (const [hash, scope] of state.scopes) {
      const query = scope.query;
      if (client.getQueryCache().get(hash) !== query || !query.isActive()) {
        state.scopes.delete(hash);
        continue;
      }
      if (scope.refreshing) continue;
      if (!scope.pending) {
        state.scopes.delete(hash);
        continue;
      }
      if (hasInboxMutation(client, scope.threadId)) continue;
      // An initial fetch cannot be replaced by invalidateQueries. Wait only
      // for this scope, then refresh even if the initial request failed.
      if (query.state.data === undefined && query.state.fetchStatus !== "idle") continue;
      scope.pending = false;
      scope.refreshing = true;
      const settled = () => {
        scope.refreshing = false;
        scheduleInboxFlush(client, state);
      };
      void client.invalidateQueries({ queryKey: query.queryKey, exact: true }).then(settled, settled);
    }
    if (state.scopes.size === 0) state.dispose();
  });
}

function inboxCoordinator(client: QueryClient): InboxCoordinator {
  const existing = inboxCoordinators.get(client);
  if (existing) return existing;
  const state: InboxCoordinator = { scopes: new Map(), scheduled: false, dispose: () => {} };
  inboxCoordinators.set(client, state);
  const wake = () => scheduleInboxFlush(client, state);
  const unsubscribeMutations = client.getMutationCache().subscribe(wake);
  const unsubscribeQueries = client.getQueryCache().subscribe(wake);
  state.dispose = () => {
    if (inboxCoordinators.get(client) !== state) return;
    inboxCoordinators.delete(client);
    unsubscribeMutations();
    unsubscribeQueries();
  };
  return state;
}

/** Coalesce per-scope refreshes behind the final thread-wide optimistic write. */
export function invalidateInbox(client: QueryClient, threadId: string) {
  const queries = client.getQueryCache().findAll({ queryKey: queryKeys.inbox.thread(threadId), type: "active" });
  if (queries.length) {
    const state = inboxCoordinator(client);
    for (const query of queries) {
      const scope = state.scopes.get(query.queryHash);
      if (scope?.query === query) scope.pending = true;
      else state.scopes.set(query.queryHash, { query, threadId, pending: true, refreshing: false });
    }
    scheduleInboxFlush(client, state);
  }
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
  const queryClient = useQueryClient();
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
        historyCount: lastPage?.historyCount ?? 0,
      }
    : undefined;
  const fetchNextPage = () => {
    // Read live cache state: a click callback may predate the refetch render.
    if (queryClient.isFetching({ queryKey: queryKeys.inbox.scope(threadId, normalized), exact: true })) return;
    void queryResult.fetchNextPage({ cancelRefetch: false });
  };
  return {
    data,
    error: queryResult.error,
    isPending: queryResult.isPending,
    isInitialPending: !data && queryResult.isPending,
    isFetching: queryResult.isFetching,
    isFetchingNextPage: queryResult.isFetchingNextPage,
    isFetchNextPageError: queryResult.isFetchNextPageError,
    hasNextPage: queryResult.hasNextPage,
    fetchNextPage,
    refetch: queryResult.refetch,
    retryFailedPage: fetchNextPage,
  };
}

type InboxData = InfiniteData<InboxPage, string | null>;
type RecordChange = { before: HumanMessage; after: HumanMessage };
type Snapshot = readonly [QueryKey, readonly RecordChange[]][];

function mapCachedMessages(data: InboxData, update: (message: HumanMessage) => HumanMessage): InboxData {
  let activeDelta = 0;
  let savedDelta = 0;
  let historyDelta = 0;
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
      historyDelta += Number(next.acknowledgedAt !== null && next.bookmarkedAt === null)
        - Number(message.acknowledgedAt !== null && message.bookmarkedAt === null);
      return next;
    }),
  }));
  return {
    ...data,
    pages: pages.map((page) => ({
      ...page,
      activeCount: Math.max(0, page.activeCount + activeDelta),
      savedCount: Math.max(0, page.savedCount + savedDelta),
      historyCount: Math.max(0, page.historyCount + historyDelta),
    })),
  };
}

function updateCachedMessages(
  queryClient: QueryClient,
  threadId: string,
  update: (message: HumanMessage) => HumanMessage,
): Snapshot {
  return queryClient.getQueriesData<InboxData>({ queryKey: queryKeys.inbox.thread(threadId) })
    .map(([key]) => {
      const changes: RecordChange[] = [];
      queryClient.setQueryData<InboxData>(key, (data) => data && mapCachedMessages(data, (message) => {
        const next = update(message);
        if (next !== message) changes.push({ before: message, after: next });
        return next;
      }));
      return [key, changes] as const;
    });
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
  for (const [key, changes] of snapshots) {
    const byId = new Map(changes.map((change) => [change.before.id, change]));
    queryClient.setQueryData<InboxData>(key, (data) => data && mapCachedMessages(data, (message) => {
      const change = byId.get(message.id);
      // A newer revision belongs to a later write; final invalidation resolves it.
      if (!change || message.revision !== change.after.revision) return message;
      return {
        ...message,
        acknowledgedAt: change.before.acknowledgedAt,
        bookmarkedAt: change.before.bookmarkedAt,
        revision: change.before.revision,
      };
    }));
  }
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
