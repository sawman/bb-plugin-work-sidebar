// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider, type InfiniteData } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys, queryPolicies } from "../../../query-runtime";
import {
  useInboxMessages,
  useInboxMutations,
  type InboxPage,
} from "../queries";
import type { HumanMessage } from "../schemas";

const { rpcClient, realtime } = vi.hoisted(() => ({
  rpcClient: { call: vi.fn() },
  realtime: { handler: null as ((payload: unknown) => void) | null },
}));

vi.mock("@get-bb/plugin-sdk/app", () => ({
  useRpc: () => rpcClient,
  useRealtime: (_channel: string, handler: (payload: unknown) => void) => {
    realtime.handler = handler;
  },
}));

const message = {
  id: "msg_one",
  threadId: "thr_one",
  projectId: "proj_one",
  subject: "Decision",
  body: "Ship it",
  agentThreadId: "thr_agent",
  providerId: "codex",
  agentLabel: "Codex",
  createdAt: "2026-09-06T00:00:00.000Z",
  updatedAt: "2026-09-06T00:00:00.000Z",
  acknowledgedAt: null,
  bookmarkedAt: null,
  revision: 1,
} as const;

const page: InboxPage = {
  messages: [message],
  cursor: null,
  activeCount: 1,
  savedCount: 0,
};

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  rpcClient.call.mockReset();
  realtime.handler = null;
});

describe("Inbox query lifecycle", () => {
  it("uses finite thread/search scope keys and finite cache retention", () => {
    expect(queryPolicies.inbox.gcTime).toBeGreaterThan(0);
    expect(queryPolicies.inbox.gcTime).toBeLessThan(Infinity);
    expect(queryKeys.inbox.scope("thr_one", " history ")).toEqual([
      "work-sidebar",
      "inbox",
      "thr_one",
      "history",
    ]);
    expect(queryKeys.inbox.scope("thr_one", "history")).toEqual(
      queryKeys.inbox.scope("thr_one", " history "),
    );
  });

  it("observes only while mounted and invalidates the exact thread family", async () => {
    rpcClient.call.mockResolvedValue(page);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", ""), {
      wrapper: wrapper(client),
    });

    await waitFor(() => expect(view.result.current.data).toEqual(page));
    expect(rpcClient.call).toHaveBeenCalledWith("listHumanMessages", {
      threadId: "thr_one",
      limit: 50,
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    realtime.handler?.({ family: "inbox", threadId: "thr_other" });
    expect(invalidate).not.toHaveBeenCalled();
    realtime.handler?.({ family: "inbox", threadId: "thr_one" });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.inbox.thread("thr_one"),
    });

    const query = client.getQueryCache().find({ queryKey: queryKeys.inbox.scope("thr_one", "") });
    expect(query?.getObserversCount()).toBeGreaterThan(0);
    view.unmount();
    expect(query?.getObserversCount()).toBe(0);
    client.clear();
  });

  it.each([
    ["success", 1], ["error", 1], ["success", 3],
  ] as const)("refetches once after an uncached initial fetch settles with %s (%s signals)", async (outcome, signals) => {
    let resolveInitial!: (value: InboxPage) => void;
    let rejectInitial!: (error: Error) => void;
    let resolveFresh!: (value: InboxPage) => void;
    const initial = new Promise<InboxPage>((resolve, reject) => {
      resolveInitial = resolve;
      rejectInitial = reject;
    });
    const fresh = new Promise<InboxPage>((resolve) => { resolveFresh = resolve; });
    rpcClient.call.mockReturnValueOnce(initial).mockReturnValueOnce(fresh);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", ""), { wrapper: wrapper(client) });
    try {
      expect(rpcClient.call).toHaveBeenCalledTimes(1);
      expect(view.result.current.data).toBeUndefined();
      const queryCleanup = trackCacheSubscriptions(client.getQueryCache());
      const mutationCleanup = trackCacheSubscriptions(client.getMutationCache());
      await act(async () => {
        for (let index = 0; index < signals; index += 1)
          realtime.handler?.({ family: "inbox", threadId: "thr_one" });
      });
      expect(rpcClient.call).toHaveBeenCalledTimes(1);
      await act(async () => {
        if (outcome === "success") resolveInitial({ ...page, messages: [], activeCount: 0 });
        else rejectInitial(new Error("Initial request failed"));
      });
      await waitFor(() => expect(rpcClient.call).toHaveBeenCalledTimes(2));
      await act(async () => { resolveFresh(page); });
      await waitFor(() => {
        expect(view.result.current.data).toEqual(page);
        expect(view.result.current.isFetching).toBe(false);
      });
      expect(rpcClient.call).toHaveBeenCalledTimes(2);
      for (const cleanups of [queryCleanup, mutationCleanup]) {
        expect(cleanups).toHaveLength(1);
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
      }
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it.each([
    ["after", 1], ["before", 1], ["before", 3],
  ] as const)("refreshes cached B once for %s abandoning uncached A (%s signals)", async (timing, signals) => {
    let resolveA!: (value: InboxPage) => void;
    let resolveB!: (value: InboxPage) => void;
    const abandoned = new Promise<InboxPage>((resolve) => { resolveA = resolve; });
    const fresh = new Promise<InboxPage>((resolve) => { resolveB = resolve; });
    const updated = { ...page, messages: [{ ...message, body: "Fresh B", revision: 2 }] };
    rpcClient.call.mockImplementation((_method: string, input: { query: string }) => {
      if (input.query === "A") return abandoned;
      return Promise.resolve(page);
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const a = renderHook(() => useInboxMessages("thr_one", "A"), { wrapper: wrapper(client) });
    if (timing === "after") a.unmount();
    const b = renderHook(() => useInboxMessages("thr_one", "B"), { wrapper: wrapper(client) });
    try {
      await waitFor(() => expect(b.result.current.isFetching).toBe(false));
      expect(b.result.current.data).toEqual(page);
      expect(a.result.current.data).toBeUndefined();
      rpcClient.call.mockImplementation((_method: string, input: { query: string }) => {
        if (input.query === "A") return abandoned;
        return fresh;
      });
      const queryCleanup = trackCacheSubscriptions(client.getQueryCache());
      const mutationCleanup = trackCacheSubscriptions(client.getMutationCache());
      const invalidate = vi.spyOn(client, "invalidateQueries");
      await act(async () => {
        for (let index = 0; index < signals; index += 1)
          realtime.handler?.({ family: "inbox", threadId: "thr_one" });
      });
      if (timing === "before") {
        expect(rpcClient.call).toHaveBeenCalledTimes(2);
        expect(invalidate).not.toHaveBeenCalled();
        a.unmount();
      }
      // A remains unresolved: neither B's refresh nor listener disposal can wait for it.
      expect(client.getQueryCache().find({ queryKey: queryKeys.inbox.scope("thr_one", "A") })?.getObserversCount()).toBe(0);
      await waitFor(() => expect(rpcClient.call).toHaveBeenCalledTimes(3));
      expect(rpcClient.call).toHaveBeenLastCalledWith("listHumanMessages", { threadId: "thr_one", query: "B", limit: 50 });
      await act(async () => { resolveB(updated); });
      await waitFor(() => {
        expect(b.result.current.data).toEqual(updated);
        expect(b.result.current.isFetching).toBe(false);
      });
      for (const cleanups of [queryCleanup, mutationCleanup]) {
        expect(cleanups).toHaveLength(1);
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
      }
      await act(async () => { resolveA(page); });
      expect(invalidate).toHaveBeenCalledTimes(1);
      expect(rpcClient.call).toHaveBeenCalledTimes(3);
      expect(b.result.current.data).toEqual(updated);
    } finally {
      a.unmount();
      b.unmount();
      client.clear();
    }
  });

  it("cleans up a deferred signal when its only uncached observer unmounts", async () => {
    rpcClient.call.mockReturnValue(new Promise<InboxPage>(() => {}));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", "A"), { wrapper: wrapper(client) });
    const queryCleanup = trackCacheSubscriptions(client.getQueryCache());
    const mutationCleanup = trackCacheSubscriptions(client.getMutationCache());
    try {
      act(() => {
        for (let index = 0; index < 3; index += 1)
          realtime.handler?.({ family: "inbox", threadId: "thr_one" });
      });
      view.unmount();
      await act(async () => {});
      for (const cleanups of [queryCleanup, mutationCleanup]) {
        expect(cleanups).toHaveLength(1);
        expect(cleanups[0]).toHaveBeenCalledTimes(1);
      }
      expect(rpcClient.call).toHaveBeenCalledTimes(1);
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it("rolls back optimistic acknowledgement when a revision conflict is returned", async () => {
    let rejectMutation!: (error: Error) => void;
    rpcClient.call.mockImplementation((method: string) => {
      if (method === "listHumanMessages") return Promise.resolve(page);
      return new Promise((_resolve, reject) => { rejectMutation = reject; });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(
      () => ({
        query: useInboxMessages("thr_one", ""),
        mutations: useInboxMutations("thr_one"),
      }),
      { wrapper: wrapper(client) },
    );

    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
    await act(async () => {
      const mutation = view.result.current.mutations.acknowledge.mutateAsync({ messageId: message.id, revision: message.revision });
      const rejection = mutation.then(() => null, (error: unknown) => error);
      await waitFor(() => expect(cachedPages(client, "thr_one")[0]?.activeCount).toBe(0));
      rejectMutation(new Error("Message changed; refresh and retry."));
      await expect(rejection).resolves.toMatchObject({ message: "Message changed; refresh and retry." });
    });
    expect(cachedPages(client, "thr_one")).toEqual([page]);
    view.unmount();
    client.clear();
  });

  it("defers same-thread realtime until optimistic mutations settle and flushes once", async () => {
    let resolveMutation!: (value: HumanMessage) => void;
    rpcClient.call.mockImplementation((method: string) => method === "listHumanMessages"
      ? Promise.resolve(page)
      : new Promise((resolve) => { resolveMutation = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({ query: useInboxMessages("thr_one", ""), mutations: useInboxMutations("thr_one") }), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const pending = view.result.current.mutations.acknowledge.mutateAsync({ messageId: message.id, revision: message.revision });
    await waitFor(() => expect(client.isMutating({ mutationKey: ["work-sidebar", "inbox", "thr_one", "optimistic"] })).toBe(1));
    realtime.handler?.({ family: "inbox", threadId: "thr_one" });
    expect(invalidate).not.toHaveBeenCalled();
    resolveMutation({ ...message, acknowledgedAt: "2026-09-06T00:00:01.000Z", revision: 2 });
    await pending;
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    view.unmount();
    client.clear();
  });

  it("flushes a signal received during asynchronous invalidation after the mutation is idle", async () => {
    let resolveMutation!: (value: HumanMessage) => void;
    let resolveInvalidation!: () => void;
    const invalidated = new Promise<void>((resolve) => { resolveInvalidation = resolve; });
    rpcClient.call.mockImplementation((method: string) => method === "listHumanMessages"
      ? Promise.resolve(page)
      : new Promise((resolve) => { resolveMutation = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({ query: useInboxMessages("thr_one", ""), mutations: useInboxMutations("thr_one") }), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
    const invalidate = vi.spyOn(client, "invalidateQueries").mockImplementation(() => invalidated);
    const mutation = view.result.current.mutations.acknowledge.mutateAsync({ messageId: message.id, revision: message.revision });
    await waitFor(() => expect(client.isMutating({ mutationKey: ["work-sidebar", "inbox", "thr_one", "optimistic"] })).toBe(1));
    realtime.handler?.({ family: "inbox", threadId: "thr_one" });
    resolveMutation({ ...message, acknowledgedAt: "2026-09-06T00:00:01.000Z", revision: 2 });
    await mutation;
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    realtime.handler?.({ family: "inbox", threadId: "thr_one" });
    resolveInvalidation();
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(2));
    view.unmount();
    client.clear();
  });

  it("coalesces signals across concurrent same-thread mutations until the last one is idle", async () => {
    let resolveAcknowledgement!: (value: HumanMessage) => void;
    let resolveBookmark!: (value: HumanMessage) => void;
    rpcClient.call.mockImplementation((method: string) => {
      if (method === "listHumanMessages") return Promise.resolve(page);
      return new Promise((resolve) => {
        if (method === "acknowledgeHumanMessage") resolveAcknowledgement = resolve;
        else resolveBookmark = resolve;
      });
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({ query: useInboxMessages("thr_one", ""), mutations: useInboxMutations("thr_one") }), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.query.data).toEqual(page));
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const acknowledgement = view.result.current.mutations.acknowledge.mutateAsync({ messageId: message.id, revision: message.revision });
    const bookmark = view.result.current.mutations.bookmark.mutateAsync({ messageId: message.id, bookmarked: true, revision: message.revision });
    await waitFor(() => expect(client.isMutating({ mutationKey: ["work-sidebar", "inbox", "thr_one", "optimistic"] })).toBe(2));
    realtime.handler?.({ family: "inbox", threadId: "thr_one" });
    resolveAcknowledgement({ ...message, acknowledgedAt: "2026-09-06T00:00:01.000Z", revision: 2 });
    await acknowledgement;
    expect(invalidate).not.toHaveBeenCalled();
    resolveBookmark({ ...message, bookmarkedAt: "2026-09-06T00:00:02.000Z", revision: 2 });
    await bookmark;
    await waitFor(() => expect(invalidate).toHaveBeenCalledTimes(1));
    view.unmount();
    client.clear();
  });

  it("projects optimistic counts once across every page in one infinite scope", async () => {
    const secondPage = { ...page, cursor: null, messages: [{ ...message, id: "msg_two" }] };
    let resolveMutation!: (value: typeof message) => void;
    rpcClient.call
      .mockResolvedValueOnce({ ...page, cursor: "next" })
      .mockResolvedValueOnce(secondPage)
      .mockImplementation((method: string) => method === "listHumanMessages"
        ? Promise.resolve({ ...page, cursor: null })
        : new Promise((resolve) => { resolveMutation = resolve; }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(
      () => ({ query: useInboxMessages("thr_one", ""), mutations: useInboxMutations("thr_one") }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(view.result.current.query.hasNextPage).toBe(true));
    act(() => view.result.current.query.fetchNextPage());
    await waitFor(() => expect(view.result.current.query.data?.messages).toHaveLength(2));
    const mutation = view.result.current.mutations.acknowledge.mutateAsync({ messageId: message.id, revision: message.revision });
    await waitFor(() => {
      expect(cachedPages(client, "thr_one").map((cached) => cached.activeCount)).toEqual([0, 0]);
    });
    resolveMutation(message);
    await mutation;
    view.unmount();
    client.clear();
  });

  it.each([
    ["acknowledge", "pending"], ["acknowledge", "succeeded"],
    ["bookmark", "pending"], ["bookmark", "succeeded"],
  ] as const)("rolls back only failed %s while another mutation is %s", async (action, otherState) => {
    const firstRecord = action === "acknowledge" ? message : { ...message, acknowledgedAt: message.createdAt };
    const activeCount = action === "acknowledge" ? 1 : 0;
    const second = { ...message, id: "msg_two", acknowledgedAt: message.createdAt };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const keys = [queryKeys.inbox.scope("thr_one", ""), queryKeys.inbox.scope("thr_one", "history")];
    for (const key of keys) client.setQueryData(key, {
      pages: [
        { messages: [firstRecord], cursor: "next", activeCount, savedCount: 0 },
        { messages: [second], cursor: null, activeCount, savedCount: 0 },
      ], pageParams: [null, "next"],
    });
    let rejectFirst!: (error: Error) => void;
    let resolveSecond!: (value: HumanMessage) => void;
    rpcClient.call.mockImplementation((_method: string, input: { messageId: string }) => new Promise((resolve, reject) => {
      if (input.messageId === message.id) rejectFirst = reject;
      else resolveSecond = resolve;
    }));
    const view = renderHook(() => useInboxMutations("thr_one"), { wrapper: wrapper(client) });
    const first = (action === "acknowledge"
      ? view.result.current.acknowledge.mutateAsync({ messageId: message.id, revision: 1 })
      : view.result.current.bookmark.mutateAsync({ messageId: message.id, bookmarked: true, revision: 1 })
    ).catch(() => undefined);
    await waitFor(() => expect(rejectFirst).toBeTypeOf("function"));
    const other = view.result.current.bookmark.mutateAsync({ messageId: second.id, bookmarked: true, revision: 1 });
    await waitFor(() => expect(resolveSecond).toBeTypeOf("function"));
    if (otherState === "succeeded") { resolveSecond({ ...second, bookmarkedAt: message.createdAt, revision: 2 }); await other; }
    // A cache update during the mutations must also survive rollback.
    for (const key of keys) client.setQueryData<InfiniteData<InboxPage>>(key, (data) => ({
      ...data!, pages: data!.pages.map((p) => ({ ...p, cursor: "fresh-cursor", activeCount: p.activeCount + 3 })),
    }));
    rejectFirst(new Error("conflict"));
    await first;
    for (const key of keys) {
      const data = client.getQueryData<InfiniteData<InboxPage>>(key)!;
      expect(data.pages[0]!.messages[0]).toEqual(firstRecord);
      expect(data.pages[1]!.messages[0]).toMatchObject({ id: second.id, bookmarkedAt: expect.any(String), revision: 2 });
      expect(data.pages.map((p) => [p.activeCount, p.savedCount, p.cursor])).toEqual([[activeCount + 3, 1, "fresh-cursor"], [activeCount + 3, 1, "fresh-cursor"]]);
    }
    if (otherState === "pending") { resolveSecond(second); await other; }
    view.unmount(); client.clear();
  });

  it.each(["fetchNextPage", "retryFailedPage"] as const)("guards %s during a realtime refetch and resumes with its refreshed cursor", async (action) => {
    let finishRefresh!: (value: InboxPage) => void;
    rpcClient.call.mockResolvedValueOnce({ ...page, cursor: "stale" })
      .mockImplementationOnce(() => new Promise((resolve) => { finishRefresh = resolve; }))
      .mockResolvedValue({ ...page, messages: [makeMessage(2)], cursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", ""), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    const staleCallback = view.result.current[action];
    act(() => realtime.handler?.({ family: "inbox", threadId: "thr_one" }));
    await waitFor(() => expect(view.result.current.isFetching).toBe(true));
    act(() => staleCallback());
    expect(rpcClient.call).toHaveBeenCalledTimes(2);
    await act(async () => finishRefresh({ ...page, cursor: "fresh" }));
    await waitFor(() => expect(view.result.current.isFetching).toBe(false));
    act(() => view.result.current[action]());
    await waitFor(() => expect(rpcClient.call).toHaveBeenLastCalledWith("listHumanMessages", expect.objectContaining({ cursor: "fresh" })));
    view.unmount(); client.clear();
  });

  it("resets pagination before a changed thread or debounced query can reuse a cursor", async () => {
    rpcClient.call
      .mockResolvedValueOnce({ ...page, cursor: "next" })
      .mockResolvedValue({ ...page, cursor: null });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(({ threadId, query }) => useInboxMessages(threadId, query), {
      initialProps: { threadId: "thr_one", query: "" },
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    act(() => view.result.current.fetchNextPage());
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledWith("listHumanMessages", expect.objectContaining({ cursor: "next" })));
    view.rerender({ threadId: "thr_two", query: "history" });
    await waitFor(() => expect(rpcClient.call).toHaveBeenLastCalledWith("listHumanMessages", {
      threadId: "thr_two", query: "history", limit: 50,
    }));
    view.unmount();
    client.clear();
  });

  it("refetches a 51-message insert chain from page one without a boundary drop or duplicate", async () => {
    const before = messageRange(1, 51);
    const after = [makeMessage(0), ...before];
    let inserted = false;
    rpcClient.call.mockImplementation((_method: string, input: { cursor?: string }) => {
      const records = inserted ? after : before;
      const boundary = inserted ? "insert-page-2" : "initial-page-2";
      if (!input.cursor) return Promise.resolve(makePage(records.slice(0, 25), boundary));
      if (input.cursor === boundary) return Promise.resolve(makePage(records.slice(25), null));
      return Promise.reject(new Error(`stale cursor ${input.cursor}`));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", ""), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    await act(async () => { view.result.current.fetchNextPage(); });
    await waitFor(() => expect(view.result.current.data?.messages).toHaveLength(51));
    inserted = true;
    await act(async () => { await view.result.current.refetch(); });
    await waitFor(() => expect(view.result.current.data?.messages).toHaveLength(52));
    expect(uniqueIds(view.result.current.data?.messages ?? [])).toEqual(after.map((entry) => entry.id));
    expect(rpcClient.call).toHaveBeenCalledWith("listHumanMessages", expect.objectContaining({ cursor: "insert-page-2" }));
    view.unmount();
    client.clear();
  });

  it("refetches a 51-message acknowledge chain from page one without a pulled-up duplicate", async () => {
    const before = messageRange(1, 51);
    const after = before.slice(1);
    let acknowledged = false;
    rpcClient.call.mockImplementation((_method: string, input: { cursor?: string }) => {
      const records = acknowledged ? after : before;
      const boundary = acknowledged ? "ack-page-2" : "initial-page-2";
      if (!input.cursor) return Promise.resolve(makePage(records.slice(0, 25), boundary));
      if (input.cursor === boundary) return Promise.resolve(makePage(records.slice(25), null));
      return Promise.reject(new Error(`stale cursor ${input.cursor}`));
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useInboxMessages("thr_one", ""), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.hasNextPage).toBe(true));
    await act(async () => { view.result.current.fetchNextPage(); });
    await waitFor(() => expect(view.result.current.data?.messages).toHaveLength(51));
    acknowledged = true;
    await act(async () => { await view.result.current.refetch(); });
    await waitFor(() => expect(view.result.current.data?.messages).toHaveLength(50));
    expect(uniqueIds(view.result.current.data?.messages ?? [])).toEqual(after.map((entry) => entry.id));
    expect(rpcClient.call).toHaveBeenCalledWith("listHumanMessages", expect.objectContaining({ cursor: "ack-page-2" }));
    view.unmount();
    client.clear();
  });
});

function cachedPages(client: QueryClient, threadId: string) {
  return client.getQueryData<InfiniteData<InboxPage, string | null>>(
    queryKeys.inbox.scope(threadId, ""),
  )?.pages ?? [];
}

function makeMessage(index: number): HumanMessage {
  return { ...message, id: `msg_${String(index).padStart(3, "0")}` };
}

function messageRange(first: number, last: number) {
  return Array.from({ length: last - first + 1 }, (_, offset) => makeMessage(first + offset));
}

function makePage(messages: readonly HumanMessage[], cursor: string | null): InboxPage {
  return { messages, cursor, activeCount: messages.length, savedCount: 0 };
}

function uniqueIds(messages: readonly HumanMessage[]) {
  const ids = messages.map((entry) => entry.id);
  expect(new Set(ids)).toHaveLength(ids.length);
  return ids;
}

function trackCacheSubscriptions<Listener>(cache: { subscribe: (listener: Listener) => () => void }) {
  const subscribe = cache.subscribe.bind(cache);
  const cleanups: ReturnType<typeof vi.fn>[] = [];
  vi.spyOn(cache, "subscribe").mockImplementation((listener: Listener) => {
    const cleanup = vi.fn(subscribe(listener));
    cleanups.push(cleanup);
    return cleanup;
  });
  return cleanups;
}
