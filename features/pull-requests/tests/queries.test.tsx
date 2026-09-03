// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pullRequestKeys,
  pullRequestPolicies,
  useAuthoredPullRequests,
  useSetAuthoredPullRequestDraft,
  useGitHubApiHealth,
  usePullRequestReviewers,
  useSharedPullRequestFactDirectory,
  useSharedThreadPullRequestDirectory,
  useThreadPullRequestDirectory,
  useUpdatePullRequestReviewers,
  type PullRequestRpc,
} from "../queries";

const authored = [
  {
    number: 12,
    title: "Query ownership",
    url: "https://github.com/acme/sidebar/pull/12",
    repository: "acme/sidebar",
    state: "open" as const,
    draft: false,
    head: "r5",
    base: "main",
    checks: "passing" as const,
    review: "approved" as const,
    reviewCommentCount: 0,
    stack: null,
  },
];

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
}

describe("R5 pull-request queries", () => {
  afterEach(() => vi.useRealTimers());

  it("owns one normalized roster directory that passive consumers reuse", async () => {
    const directory = {
      thr_a: {
        number: 42,
        title: "Shared fact",
        url: "https://github.com/acme/sidebar/pull/42",
        state: "open" as const,
        head: "feature/shared",
        base: "main",
        checks: {
          failedCount: 0,
          passedCount: 2,
          pendingCount: 0,
          state: "passing" as const,
          totalCount: 2,
        },
        review: { reviewRequestCount: 1, state: "review_required" as const },
        attention: "review_requested" as const,
        mergeability: {
          mergeStateStatus: "CLEAN" as const,
          mergeable: "MERGEABLE" as const,
          state: "mergeable" as const,
        },
        signal: {
          checks: "passing" as const,
          review: "review_required" as const,
          requestedReviewers: ["octocat"],
          reviewCommentCount: 0,
        },
        stackNumber: 17,
      },
      thr_b: null,
    };
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        expect(method).toBe("sidebarThreadPullRequests");
        expect(input).toEqual({ threadIds: ["thr_a", "thr_b"] });
        return { available: true, pullRequests: directory, error: null };
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const owner = renderHook(
      () => useThreadPullRequestDirectory(rpc, ["thr_b", "thr_a", "thr_a"], true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(owner.result.current.data?.thr_a?.signal.review).toBe(
        "review_required",
      ),
    );
    const consumer = renderHook(() => useSharedThreadPullRequestDirectory(), {
      wrapper: wrapper(client),
    });
    expect(consumer.result.current.data).toEqual(directory);
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(owner.result.current.data?.thr_a?.stackNumber).toBe(17);
    const facts = renderHook(() => useSharedPullRequestFactDirectory(), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(
        facts.result.current.data?.facts["acme/sidebar#42"]?.signal.review,
      ).toBe("review_required"),
    );
    owner.unmount();
    consumer.unmount();
    facts.unmount();
    client.clear();
  });

  it("publishes a refreshed thread fact into the authored-row cache", async () => {
    const threadFact = {
      number: 12,
      title: "Query ownership",
      url: "https://github.com/acme/sidebar/pull/12",
      state: "open" as const,
      head: "r5",
      base: "main",
      checks: {
        failedCount: 0,
        passedCount: 2,
        pendingCount: 0,
        state: "passing" as const,
        totalCount: 2,
      },
      review: { reviewRequestCount: 1, state: "review_required" as const },
      attention: "review_requested" as const,
      mergeability: {
        mergeStateStatus: "CLEAN" as const,
        mergeable: "MERGEABLE" as const,
        state: "mergeable" as const,
      },
      signal: {
        checks: "passing" as const,
        review: "review_required" as const,
        requestedReviewers: ["octocat"],
        reviewCommentCount: 0,
      },
      stackNumber: null,
    };
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return { available: true, pullRequests: authored, error: null };
        if (method === "sidebarAuthoredPullRequestStacks")
          return { available: true, pullRequests: authored, error: null };
        if (method === "sidebarThreadPullRequests")
          return {
            available: true,
            pullRequests: { thr_a: threadFact },
            error: null,
          };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const authoredView = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(authoredView.result.current.data?.[0]?.review).toBe("approved"),
    );
    const directory = renderHook(
      () => useThreadPullRequestDirectory(rpc, ["thr_a"], true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(authoredView.result.current.data?.[0]).toMatchObject({
        review: "review_required",
        requestedReviewers: ["octocat"],
      }),
    );
    directory.unmount();
    authoredView.unmount();
    client.clear();
  });

  it("covers a large roster in contract-bounded directory batches", async () => {
    const threadIds = Array.from({ length: 201 }, (_, index) =>
      `thr_${String(index).padStart(3, "0")}`,
    );
    const call = vi.fn(async (_method: string, input: { threadIds: string[] }) => ({
        available: true,
        pullRequests: Object.fromEntries(
          input.threadIds.map((threadId) => [threadId, null]),
        ),
        error: null,
      }));
    const rpc = {
      call,
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useThreadPullRequestDirectory(rpc, [...threadIds].reverse(), true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(Object.keys(view.result.current.data ?? {})).toHaveLength(201),
    );
    expect(call).toHaveBeenCalledTimes(2);
    expect(
      call.mock.calls.map(
        ([, input]) => (input as { threadIds: string[] }).threadIds.length,
      ),
    ).toEqual([200, 1]);
    view.unmount();
    client.clear();
  });

  it("compacts, cancels, and eventually releases the directory with its roster", async () => {
    const oldRoster = deferred<{
      available: boolean;
      pullRequests: Record<string, null>;
      error: null;
    }>();
    const nextRoster = deferred<{
      available: boolean;
      pullRequests: Record<string, null>;
      error: null;
    }>();
    const rpc = {
      call: vi.fn((_method: string, input: { threadIds: string[] }) =>
        input.threadIds[0] === "thr_old" ? oldRoster.promise : nextRoster.promise,
      ),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ threadIds, enabled }: { threadIds: string[]; enabled: boolean }) =>
        useThreadPullRequestDirectory(rpc, threadIds, enabled),
      {
        wrapper: wrapper(client),
        initialProps: { threadIds: ["thr_old"], enabled: true },
      },
    );
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1));

    view.rerender({ threadIds: ["thr_next"], enabled: true });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    expect(view.result.current.data?.thr_old).toBeUndefined();

    oldRoster.resolve({
      available: true,
      pullRequests: { thr_old: null },
      error: null,
    });
    await act(async () => Promise.resolve());
    expect(view.result.current.data?.thr_old).toBeUndefined();

    nextRoster.resolve({
      available: true,
      pullRequests: { thr_next: null },
      error: null,
    });
    await waitFor(() =>
      expect(view.result.current.data).toEqual({ thr_next: null }),
    );

    view.rerender({ threadIds: [], enabled: true });
    await waitFor(() => expect(view.result.current.data).toEqual({}));
    expect(rpc.call).toHaveBeenCalledTimes(2);
    expect(pullRequestPolicies.threadDirectory).toMatchObject({
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnReconnect: false,
    });
    view.unmount();
    expect(
      client
        .getQueryCache()
        .find({ queryKey: pullRequestKeys.threadDirectory() })
        ?.getObserversCount(),
    ).toBe(0);
    client.clear();
  });

  it("garbage-collects an unobserved directory after the short remount window", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await client.fetchQuery({
      queryKey: pullRequestKeys.threadDirectory(),
      queryFn: async () => ({ thr_a: null }),
      ...pullRequestPolicies.threadDirectory,
    });
    expect(
      client
        .getQueryCache()
        .find({ queryKey: pullRequestKeys.threadDirectory() }),
    ).toBeDefined();

    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: pullRequestKeys.threadDirectory() }),
    ).toBeUndefined();
    client.clear();
  });

  it("garbage-collects unobserved normalized facts after their handoff window", async () => {
    vi.useFakeTimers();
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    await client.fetchQuery({
      queryKey: pullRequestKeys.factDirectory(),
      queryFn: async () => ({ facts: {}, threadFactKeys: {} }),
      ...pullRequestPolicies.factDirectory,
    });

    await vi.advanceTimersByTimeAsync(15 * 60_000);

    expect(
      client
        .getQueryCache()
        .find({ queryKey: pullRequestKeys.factDirectory() }),
    ).toBeUndefined();
    client.clear();
  });

  it("progressively paints the shared authored list before deferred stack enrichment settles", async () => {
    const stacks = deferred<{
      available: boolean;
      pullRequests: typeof authored;
      error: null;
    }>();
    const rpc = {
      call: vi.fn((method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return Promise.resolve({
            available: true,
            pullRequests: authored,
            error: null,
          });
        if (method === "sidebarAuthoredPullRequestStacks")
          return stacks.promise;
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const left = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    const right = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(left.result.current.data).toEqual(authored));
    expect(right.result.current.data).toEqual(authored);
    expect(rpc.call).toHaveBeenCalledTimes(2);
    const enriched = [{ ...authored[0]!, title: "Enriched Stack" }];
    stacks.resolve({ available: true, pullRequests: enriched, error: null });
    await waitFor(() => expect(left.result.current.data).toEqual(enriched));
    await act(async () => {
      left.unmount();
      right.unmount();
      await Promise.resolve();
    });
    client.clear();
  });

  it("retries one transient stack-enrichment failure without a manual refresh", async () => {
    vi.useFakeTimers();
    let stackReads = 0;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return { available: true, pullRequests: authored, error: null };
        if (method === "sidebarAuthoredPullRequestStacks") {
          stackReads += 1;
          if (stackReads === 1)
            return {
              available: false,
              pullRequests: [],
              error: "Transient Stack lookup failure",
            };
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: "Recovered stack" }],
            error: null,
          };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retryDelay: 1 } },
    });
    const view = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });
    expect(stackReads).toBe(2);
    expect(view.result.current.data?.[0]?.title).toBe("Recovered stack");
    view.unmount();
    client.clear();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  });

  it("re-enriches a newer base generation even when the previous stack result settled first", async () => {
    const nextStacks = deferred<{
      available: boolean;
      pullRequests: typeof authored;
      error: null;
    }>();
    let stackReads = 0;
    const rpc = {
      call: vi.fn((method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return Promise.resolve({
            available: true,
            pullRequests: authored,
            error: null,
          });
        if (method === "sidebarAuthoredPullRequestStacks") {
          stackReads += 1;
          if (stackReads === 1)
            return Promise.resolve({
              available: true,
              pullRequests: [{ ...authored[0]!, title: "first stack" }],
              error: null,
            });
          return nextStacks.promise;
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(view.result.current.data?.[0]?.title).toBe("first stack"),
    );

    act(() => {
      client.setQueryData(
        pullRequestKeys.authored(),
        [{ ...authored[0]!, title: "second base" }],
        { updatedAt: Date.now() + 1_000 },
      );
    });
    await waitFor(() => expect(stackReads).toBe(2));
    expect(view.result.current.data?.[0]?.title).toBe("second base");

    nextStacks.resolve({
      available: true,
      pullRequests: [{ ...authored[0]!, title: "second stack" }],
      error: null,
    });
    await waitFor(() =>
      expect(view.result.current.data?.[0]?.title).toBe("second stack"),
    );
    view.unmount();
    client.clear();
  });

  it("shares authored PR list and stack cache across left/right consumers, force-refreshes server data, and filters no client records", async () => {
    let reads = 0;
    let version = "base";
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          reads += 1;
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: version }],
            error: null,
          };
        }
        if (method === "sidebarAuthoredPullRequestStacks")
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: `${version} stack` }],
            error: null,
          };
        if (method === "getGitHubApiHealth")
          return {
            state: "available",
            scope: "unknown",
            message: null,
            retryAt: null,
          };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const left = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    const right = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() =>
      expect(left.result.current.data?.[0]?.title).toBe("base stack"),
    );
    expect(right.result.current.data?.[0]?.title).toBe("base stack");
    expect(reads).toBe(1);
    expect(client.getQueryData(pullRequestKeys.authored())).toEqual([
      { ...authored[0]!, title: "base" },
    ]);
    expect(
      pullRequestPolicies.authored.refetchInterval({ intervalMs: 7_000 }),
    ).toBe(7_000);

    version = "forced";
    await act(async () => {
      await left.result.current.refresh();
    });
    await waitFor(() => expect(reads).toBe(2));
    expect(rpc.call).toHaveBeenCalledWith("sidebarAuthoredPullRequests", {
      force: true,
    });
    await waitFor(() =>
      expect(left.result.current.data?.[0]?.title).toBe("forced stack"),
    );
    left.unmount();
    right.unmount();
    client.clear();
  });

  it("keeps a manual refresh pending until the new stack projection settles", async () => {
    const refreshedStacks = deferred<{
      available: boolean;
      pullRequests: typeof authored;
      error: null;
    }>();
    let forced = false;
    let stackReads = 0;
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          forced = (input as { force?: boolean }).force === true;
          return { available: true, pullRequests: authored, error: null };
        }
        if (method === "sidebarAuthoredPullRequestStacks") {
          stackReads += 1;
          if (forced) return refreshedStacks.promise;
          return { available: true, pullRequests: authored, error: null };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(stackReads).toBe(1));

    let settled = false;
    const refresh = view.result.current.refresh().finally(() => {
      settled = true;
    });
    await waitFor(() => expect(stackReads).toBe(2));
    expect(view.result.current.data).toEqual(authored);
    expect(view.result.current.isFetching).toBe(true);
    expect(settled).toBe(false);

    refreshedStacks.resolve({
      available: true,
      pullRequests: [{ ...authored[0]!, title: "refreshed stack" }],
      error: null,
    });
    await act(async () => refresh);
    expect(settled).toBe(true);
    await waitFor(() =>
      expect(view.result.current.data?.[0]?.title).toBe("refreshed stack"),
    );
    view.unmount();
    client.clear();
  });

  it("revalidates base and stack enrichment at the configured interval", async () => {
    vi.useFakeTimers();
    let revision = "first";
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: `${revision} base` }],
            error: null,
          };
        if (method === "sidebarAuthoredPullRequestStacks")
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: `${revision} stack` }],
            error: null,
          };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useAuthoredPullRequests(rpc, { intervalMs: 1_000 }),
      { wrapper: wrapper(client) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(view.result.current.data?.[0]?.title).toBe("first stack");
    revision = "second";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(view.result.current.data?.[0]?.title).toBe("second stack");
    revision = "third";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(view.result.current.data?.[0]?.title).toBe("third stack");
    expect(pullRequestPolicies.authored).toMatchObject({
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      retry: false,
    });
    expect(pullRequestPolicies.authoredStacks).toMatchObject({
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      retry: 1,
    });
    view.unmount();
    client.clear();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
  });

  it("cancels stale stack enrichment before a manual forced rebuild", async () => {
    const oldStack = deferred<{
      available: boolean;
      pullRequests: typeof authored;
      error: null;
    }>();
    let stackReads = 0;
    const rpc = {
      call: vi.fn((method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          const forced = (input as { force?: boolean }).force === true;
          return Promise.resolve({
            available: true,
            pullRequests: [
              { ...authored[0]!, title: forced ? "new base" : "old base" },
            ],
            error: null,
          });
        }
        if (method === "sidebarAuthoredPullRequestStacks") {
          stackReads += 1;
          if (stackReads === 1) return oldStack.promise;
          return Promise.resolve({
            available: true,
            pullRequests: [{ ...authored[0]!, title: "new stack" }],
            error: null,
          });
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => ({
        list: useAuthoredPullRequests(rpc),
      }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(view.result.current.list.data?.[0]?.title).toBe("old base"),
    );
    await act(async () => {
      await view.result.current.list.refresh();
    });
    await waitFor(() =>
      expect(view.result.current.list.data?.[0]?.title).toBe("new stack"),
    );
    oldStack.resolve({
      available: true,
      pullRequests: [{ ...authored[0]!, title: "old stack" }],
      error: null,
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(view.result.current.list.data?.[0]?.title).toBe("new stack");
    view.unmount();
    client.clear();
  });

  it("gives the stable left surface the only Query-owned visible health interval", async () => {
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    const previousVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "getGitHubApiHealth")
          return {
            state: "available",
            scope: "unknown",
            message: null,
            retryAt: null,
          };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const left = renderHook(() => useGitHubApiHealth(rpc, { poll: true }), {
      wrapper: wrapper(client),
    });
    const right = renderHook(() => useGitHubApiHealth(rpc, { poll: false }), {
      wrapper: wrapper(client),
    });
    const inactive = renderHook(
      () => useGitHubApiHealth(rpc, { poll: true, enabled: false }),
      { wrapper: wrapper(client) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(pullRequestPolicies.health).toMatchObject({
      staleTime: 15_000,
      gcTime: 2 * 60_000,
      retry: false,
      refetchInterval: 30_000,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpc.call).toHaveBeenCalledTimes(3);
    left.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpc.call).toHaveBeenCalledTimes(3);
    await act(async () => {
      right.unmount();
      await Promise.resolve();
    });
    inactive.unmount();
    client.clear();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(vi.getTimerCount()).toBe(0);
    if (previousVisibility)
      Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
  });

  it("records a forced authored refresh failure in the base query and recovers on retry", async () => {
    let failForce = true;
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          if ((input as { force?: boolean }).force && failForce)
            throw new Error("forced GitHub failure");
          return { available: true, pullRequests: authored, error: null };
        }
        if (method === "sidebarAuthoredPullRequestStacks")
          return { available: true, pullRequests: authored, error: null };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useAuthoredPullRequests(rpc), {
      wrapper: wrapper(client),
    });
    await waitFor(() => expect(view.result.current.data).toEqual(authored));
    await expect(view.result.current.refresh()).rejects.toThrow(
      "forced GitHub failure",
    );
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(rpc.call).toHaveBeenCalledWith("sidebarAuthoredPullRequests", {
      force: true,
    });
    failForce = false;
    await act(async () => {
      await view.result.current.refresh();
    });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    view.unmount();
    client.clear();
  });

  it("exposes draft mutation busy/error state and invalidates only the authored PR family after settlement", async () => {
    let reject = true;
    let rejectDraft!: (error: Error) => void;
    const pendingDraft = new Promise<{ draft: boolean }>(
      (_resolve, rejectPromise) => {
        rejectDraft = rejectPromise;
      },
    );
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "setAuthoredPullRequestDraft") {
          if (reject) return pendingDraft;
          return { draft: true };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const mutation = renderHook(() => useSetAuthoredPullRequestDraft(rpc), {
      wrapper: wrapper(client),
    });
    act(() => {
      mutation.result.current.mutate({ url: authored[0]!.url, draft: true });
    });
    await waitFor(() => expect(mutation.result.current.isPending).toBe(true));
    rejectDraft(new Error("GitHub refused draft update"));
    await waitFor(() => expect(mutation.result.current.isError).toBe(true));
    expect(mutation.result.current.error?.message).toContain("refused");
    reject = false;
    await act(async () => {
      await mutation.result.current.mutateAsync({
        url: authored[0]!.url,
        draft: true,
      });
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pullRequestKeys.authored(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pullRequestKeys.authoredStacks(),
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: ["work-sidebar", "work"],
    });
    mutation.unmount();
    client.clear();
  });

  it("shows fresh base data instead of stale stacks after a failed then successful draft mutation", async () => {
    const refreshedStack = deferred<{
      available: boolean;
      pullRequests: typeof authored;
      error: null;
    }>();
    let revision = "old";
    let draftAttempts = 0;
    let deferStacks = false;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: `${revision} base` }],
            error: null,
          };
        if (method === "sidebarAuthoredPullRequestStacks") {
          if (deferStacks) return refreshedStack.promise;
          return {
            available: true,
            pullRequests: [{ ...authored[0]!, title: "old stack" }],
            error: null,
          };
        }
        if (method === "setAuthoredPullRequestDraft") {
          draftAttempts += 1;
          if (draftAttempts === 1) throw new Error("draft update failed");
          revision = "new";
          deferStacks = true;
          return { draft: true };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => ({
        list: useAuthoredPullRequests(rpc),
        draft: useSetAuthoredPullRequestDraft(rpc),
      }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(view.result.current.list.data?.[0]?.title).toBe("old stack"),
    );

    act(() => {
      view.result.current.draft.mutate({ url: authored[0]!.url, draft: true });
    });
    await waitFor(() => expect(view.result.current.draft.isError).toBe(true));
    expect(view.result.current.list.data?.[0]?.title).toBe("old stack");

    act(() => {
      view.result.current.draft.mutate({ url: authored[0]!.url, draft: true });
    });
    await waitFor(() =>
      expect(view.result.current.list.data?.[0]?.title).toBe("new base"),
    );
    expect(view.result.current.draft.isPending).toBe(true);
    refreshedStack.resolve({
      available: true,
      pullRequests: [{ ...authored[0]!, title: "new stack" }],
      error: null,
    });
    await waitFor(() =>
      expect(view.result.current.list.data?.[0]?.title).toBe("new stack"),
    );
    await waitFor(() => expect(view.result.current.draft.isSuccess).toBe(true));
    view.unmount();
    client.clear();
  });

  it("loads the reviewer directory only while used and reuses it for 24 hours", async () => {
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method !== "getPullRequestReviewers")
          throw new Error(`unexpected ${method}`);
        expect(input).toEqual({ repository: "acme/sidebar" });
        return {
          available: true,
          reviewers: [{ login: "octocat", name: "Octo Cat", avatarUrl: null }],
          error: null,
        };
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const inactive = renderHook(
      () => usePullRequestReviewers(rpc, "acme/sidebar", false),
      { wrapper: wrapper(client) },
    );
    await act(async () => Promise.resolve());
    expect(rpc.call).not.toHaveBeenCalled();
    inactive.unmount();

    const first = renderHook(
      () => usePullRequestReviewers(rpc, "acme/sidebar", true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(first.result.current.data?.[0]?.login).toBe("octocat"),
    );
    first.unmount();
    const second = renderHook(
      () => usePullRequestReviewers(rpc, "acme/sidebar", true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(second.result.current.data).toHaveLength(1));
    expect(rpc.call).toHaveBeenCalledOnce();
    expect(pullRequestPolicies.reviewers).toEqual({
      staleTime: 24 * 60 * 60_000,
      gcTime: 24 * 60 * 60_000,
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    second.unmount();
    client.clear();
  });

  it("refreshes an observed reviewer directory explicitly and invalidates PRs after updates", async () => {
    let reviewerReads = 0;
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests")
          return { available: true, pullRequests: authored, error: null };
        if (method === "sidebarAuthoredPullRequestStacks")
          return { available: true, pullRequests: authored, error: null };
        if (method === "getPullRequestReviewers") {
          reviewerReads += 1;
          expect(input).toEqual(
            reviewerReads === 1
              ? { repository: "acme/sidebar" }
              : { repository: "acme/sidebar", force: true },
          );
          return {
            available: true,
            reviewers: [
              {
                login: reviewerReads === 1 ? "alice" : "bob",
                name: null,
                avatarUrl: null,
              },
            ],
            error: null,
          };
        }
        if (method === "updatePullRequestReviewers") {
          expect(input).toEqual({
            repository: "acme/sidebar",
            number: 12,
            reviewers: ["bob"],
          });
          return { reviewers: ["bob"] };
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(
      () => ({
        list: useAuthoredPullRequests(rpc),
        reviewers: usePullRequestReviewers(rpc, "acme/sidebar", true),
        update: useUpdatePullRequestReviewers(rpc),
      }),
      { wrapper: wrapper(client) },
    );
    await waitFor(() =>
      expect(view.result.current.reviewers.data?.[0]?.login).toBe("alice"),
    );

    await act(async () => view.result.current.list.refresh());
    await waitFor(() =>
      expect(view.result.current.reviewers.data?.[0]?.login).toBe("bob"),
    );
    expect(reviewerReads).toBe(2);

    await act(async () =>
      view.result.current.update.mutateAsync({
        repository: "acme/sidebar",
        number: 12,
        reviewers: ["bob"],
      }),
    );
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pullRequestKeys.authored(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: pullRequestKeys.authoredStacks(),
    });
    view.unmount();
    client.clear();
  });
});
