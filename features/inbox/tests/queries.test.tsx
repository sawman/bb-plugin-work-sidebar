// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys, queryPolicies } from "../../../query-runtime";
import {
  useInboxMessages,
  useInboxMutations,
  type InboxPage,
} from "../queries";

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
  it("uses finite thread/search/cursor keys and finite cache retention", () => {
    expect(queryPolicies.inbox.gcTime).toBeGreaterThan(0);
    expect(queryPolicies.inbox.gcTime).toBeLessThan(Infinity);
    expect(queryKeys.inbox.page("thr_one", " history ", null)).toEqual([
      "work-sidebar",
      "inbox",
      "thr_one",
      "history",
      "first",
    ]);
    expect(queryKeys.inbox.page("thr_one", "history", "cursor-2")).not.toEqual(
      queryKeys.inbox.page("thr_one", "history", null),
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

    const query = client.getQueryCache().find({ queryKey: queryKeys.inbox.page("thr_one", "", null) });
    expect(query?.getObserversCount()).toBeGreaterThan(0);
    view.unmount();
    expect(query?.getObserversCount()).toBe(0);
    client.clear();
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
      await waitFor(() => expect(client.getQueryData<InboxPage>(queryKeys.inbox.page("thr_one", "", null))?.activeCount).toBe(0));
      rejectMutation(new Error("Message changed; refresh and retry."));
      await expect(rejection).resolves.toMatchObject({ message: "Message changed; refresh and retry." });
    });
    expect(client.getQueryData(queryKeys.inbox.page("thr_one", "", null))).toEqual(page);
    view.unmount();
    client.clear();
  });

  it("projects optimistic counts consistently across every cached cursor page", async () => {
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
      expect(client.getQueryData<InboxPage>(queryKeys.inbox.page("thr_one", "", null))?.activeCount).toBe(0);
      expect(client.getQueryData<InboxPage>(queryKeys.inbox.page("thr_one", "", "next"))?.activeCount).toBe(0);
    });
    resolveMutation(message);
    await mutation;
    view.unmount();
    client.clear();
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
});
