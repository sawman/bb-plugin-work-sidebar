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
  useSidebarPullRequestStacks,
  type PullRequestRpc,
} from "../queries";

const authored = [{
  number: 12, title: "Query ownership", url: "https://github.com/acme/sidebar/pull/12", repository: "acme/sidebar",
  state: "open" as const, draft: false, head: "r5", base: "main", checks: "passing" as const,
  review: "approved" as const, reviewCommentCount: 0, stack: null,
}];

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

describe("R5 pull-request queries", () => {
  afterEach(() => vi.useRealTimers());

  it("normalizes one bounded thread-roster stack read and keeps it inactive off the Work view", async () => {
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method !== "sidebarPullRequestStacks")
          throw new Error(`unexpected ${method}`);
        expect(input).toEqual({ threadIds: ["thr_a", "thr_b"] });
        return {
          available: true,
          stacks: {
            thr_a: {
              id: "github-stack:thr_a:17",
              number: 17,
              base: "main",
              currentPullRequest: 42,
              pullRequests: [],
            },
          },
          mergeTargets: {},
          error: null,
        };
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const inactive = renderHook(
      () => useSidebarPullRequestStacks(rpc, ["thr_b", "thr_a", "thr_a"], false),
      { wrapper: wrapper(client) },
    );
    await act(async () => Promise.resolve());
    expect(rpc.call).not.toHaveBeenCalled();

    inactive.rerender();
    const active = renderHook(
      () => useSidebarPullRequestStacks(rpc, ["thr_b", "thr_a", "thr_a"], true),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(active.result.current.data?.thr_a?.number).toBe(17));
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(pullRequestPolicies.sidebarStacks).toMatchObject({
      staleTime: 60_000,
      gcTime: 15 * 60_000,
      retry: false,
    });
    inactive.unmount();
    active.unmount();
    client.clear();
  });

  it("progressively paints the shared authored list before deferred stack enrichment settles", async () => {
    const stacks = deferred<{ available: boolean; pullRequests: typeof authored; error: null }>();
    const rpc = {
      call: vi.fn((method: string) => {
        if (method === "sidebarAuthoredPullRequests") return Promise.resolve({ available: true, pullRequests: authored, error: null });
        if (method === "sidebarAuthoredPullRequestStacks") return stacks.promise;
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const left = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    const right = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    await waitFor(() => expect(left.result.current.data).toEqual(authored));
    expect(right.result.current.data).toEqual(authored);
    expect(rpc.call).toHaveBeenCalledTimes(2);
    const enriched = [{ ...authored[0]!, title: "Enriched Stack" }];
    stacks.resolve({ available: true, pullRequests: enriched, error: null });
    await waitFor(() => expect(left.result.current.data).toEqual(enriched));
    await act(async () => { left.unmount(); right.unmount(); await Promise.resolve(); });
    client.clear();
  });

  it("re-enriches a newer base generation even when the previous stack result settled first", async () => {
    const nextStacks = deferred<{ available: boolean; pullRequests: typeof authored; error: null }>();
    let stackReads = 0;
    const rpc = {
      call: vi.fn((method: string) => {
        if (method === "sidebarAuthoredPullRequests")
          return Promise.resolve({ available: true, pullRequests: authored, error: null });
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
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
        if (method === "sidebarAuthoredPullRequests") { reads += 1; return { available: true, pullRequests: [{ ...authored[0]!, title: version }], error: null }; }
        if (method === "sidebarAuthoredPullRequestStacks") return { available: true, pullRequests: [{ ...authored[0]!, title: `${version} stack` }], error: null };
        if (method === "getGitHubApiHealth") return { state: "available", scope: "unknown", message: null, retryAt: null };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const left = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    const right = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    await waitFor(() => expect(left.result.current.data?.[0]?.title).toBe("base stack"));
    expect(right.result.current.data?.[0]?.title).toBe("base stack");
    expect(reads).toBe(1);
    expect(client.getQueryData(pullRequestKeys.authored())).toEqual([{ ...authored[0]!, title: "base" }]);
    expect(pullRequestPolicies.authored.refetchInterval({ intervalMs: 7_000 })).toBe(7_000);

    version = "forced";
    await act(async () => { await left.result.current.refresh(); });
    await waitFor(() => expect(reads).toBe(2));
    expect(rpc.call).toHaveBeenCalledWith("sidebarAuthoredPullRequests", { force: true });
    await waitFor(() => expect(left.result.current.data?.[0]?.title).toBe("forced stack"));
    left.unmount();
    right.unmount();
    client.clear();
  });

  it("revalidates base and stack enrichment at the configured interval", async () => {
    vi.useFakeTimers();
    let revision = "first";
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests") return { available: true, pullRequests: [{ ...authored[0]!, title: `${revision} base` }], error: null };
        if (method === "sidebarAuthoredPullRequestStacks") return { available: true, pullRequests: [{ ...authored[0]!, title: `${revision} stack` }], error: null };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useAuthoredPullRequests(rpc, { intervalMs: 1_000 }), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); await Promise.resolve(); await Promise.resolve(); });
    expect(view.result.current.data?.[0]?.title).toBe("first stack");
    revision = "second";
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); });
    expect(view.result.current.data?.[0]?.title).toBe("second stack");
    revision = "third";
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); });
    expect(view.result.current.data?.[0]?.title).toBe("third stack");
    expect(pullRequestPolicies.authored).toMatchObject({ staleTime: 60_000, gcTime: 15 * 60_000, retry: false });
    expect(pullRequestPolicies.authoredStacks).toMatchObject({ staleTime: 60_000, gcTime: 15 * 60_000, retry: false });
    view.unmount();
    client.clear();
    await act(async () => { await vi.runAllTimersAsync(); });
  });

  it("cancels stale stack enrichment before a manual forced rebuild", async () => {
    const oldStack = deferred<{ available: boolean; pullRequests: typeof authored; error: null }>();
    let stackReads = 0;
    const rpc = {
      call: vi.fn((method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          const forced = (input as { force?: boolean }).force === true;
          return Promise.resolve({ available: true, pullRequests: [{ ...authored[0]!, title: forced ? "new base" : "old base" }], error: null });
        }
        if (method === "sidebarAuthoredPullRequestStacks") {
          stackReads += 1;
          if (stackReads === 1) return oldStack.promise;
          return Promise.resolve({ available: true, pullRequests: [{ ...authored[0]!, title: "new stack" }], error: null });
        }
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({
      list: useAuthoredPullRequests(rpc),
    }), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.list.data?.[0]?.title).toBe("old base"));
    await act(async () => { await view.result.current.list.refresh(); });
    await waitFor(() => expect(view.result.current.list.data?.[0]?.title).toBe("new stack"));
    oldStack.resolve({ available: true, pullRequests: [{ ...authored[0]!, title: "old stack" }], error: null });
    await act(async () => { await Promise.resolve(); });
    expect(view.result.current.list.data?.[0]?.title).toBe("new stack");
    view.unmount();
    client.clear();
  });

  it("gives the stable left surface the only Query-owned visible health interval", async () => {
    vi.useFakeTimers();
    expect(vi.getTimerCount()).toBe(0);
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getGitHubApiHealth") return { state: "available", scope: "unknown", message: null, retryAt: null };
      throw new Error(`unexpected ${method}`);
    }) } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const left = renderHook(() => useGitHubApiHealth(rpc, { poll: true }), { wrapper: wrapper(client) });
    const right = renderHook(() => useGitHubApiHealth(rpc, { poll: false }), { wrapper: wrapper(client) });
    const inactive = renderHook(() => useGitHubApiHealth(rpc, { poll: true, enabled: false }), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    expect(pullRequestPolicies.health).toMatchObject({ staleTime: 15_000, gcTime: 2 * 60_000, retry: false, refetchInterval: 30_000 });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.call).toHaveBeenCalledTimes(3);
    left.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(rpc.call).toHaveBeenCalledTimes(3);
    await act(async () => { right.unmount(); await Promise.resolve(); });
    inactive.unmount();
    client.clear();
    await act(async () => { await vi.runAllTimersAsync(); });
    expect(vi.getTimerCount()).toBe(0);
    if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
  });

  it("records a forced authored refresh failure in the base query and recovers on retry", async () => {
    let failForce = true;
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        if (method === "sidebarAuthoredPullRequests") {
          if ((input as { force?: boolean }).force && failForce) throw new Error("forced GitHub failure");
          return { available: true, pullRequests: authored, error: null };
        }
        if (method === "sidebarAuthoredPullRequestStacks") return { available: true, pullRequests: authored, error: null };
        throw new Error(`unexpected ${method}`);
      }),
    } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.data).toEqual(authored));
    await expect(view.result.current.refresh()).rejects.toThrow("forced GitHub failure");
    await waitFor(() => expect(view.result.current.isError).toBe(true));
    expect(rpc.call).toHaveBeenCalledWith("sidebarAuthoredPullRequests", { force: true });
    failForce = false;
    await act(async () => { await view.result.current.refresh(); });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    view.unmount();
    client.clear();
  });

  it("exposes draft mutation busy/error state and invalidates only the authored PR family after settlement", async () => {
    let reject = true;
    let rejectDraft!: (error: Error) => void;
    const pendingDraft = new Promise<{ draft: boolean }>((_resolve, rejectPromise) => { rejectDraft = rejectPromise; });
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "setAuthoredPullRequestDraft") {
        if (reject) return pendingDraft;
        return { draft: true };
      }
      throw new Error(`unexpected ${method}`);
    }) } as unknown as PullRequestRpc;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const mutation = renderHook(() => useSetAuthoredPullRequestDraft(rpc), { wrapper: wrapper(client) });
    act(() => { mutation.result.current.mutate({ url: authored[0]!.url, draft: true }); });
    await waitFor(() => expect(mutation.result.current.isPending).toBe(true));
    rejectDraft(new Error("GitHub refused draft update"));
    await waitFor(() => expect(mutation.result.current.isError).toBe(true));
    expect(mutation.result.current.error?.message).toContain("refused");
    reject = false;
    await act(async () => { await mutation.result.current.mutateAsync({ url: authored[0]!.url, draft: true }); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pullRequestKeys.authored() });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: pullRequestKeys.authoredStacks() });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["work-sidebar", "work"] });
    mutation.unmount();
    client.clear();
  });

  it("shows fresh base data instead of stale stacks after a failed then successful draft mutation", async () => {
    const refreshedStack = deferred<{ available: boolean; pullRequests: typeof authored; error: null }>();
    let revision = "old";
    let draftAttempts = 0;
    let deferStacks = false;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests") return { available: true, pullRequests: [{ ...authored[0]!, title: `${revision} base` }], error: null };
        if (method === "sidebarAuthoredPullRequestStacks") {
          if (deferStacks) return refreshedStack.promise;
          return { available: true, pullRequests: [{ ...authored[0]!, title: "old stack" }], error: null };
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
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({
      list: useAuthoredPullRequests(rpc),
      draft: useSetAuthoredPullRequestDraft(rpc),
    }), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.list.data?.[0]?.title).toBe("old stack"));

    act(() => { view.result.current.draft.mutate({ url: authored[0]!.url, draft: true }); });
    await waitFor(() => expect(view.result.current.draft.isError).toBe(true));
    expect(view.result.current.list.data?.[0]?.title).toBe("old stack");

    act(() => { view.result.current.draft.mutate({ url: authored[0]!.url, draft: true }); });
    await waitFor(() => expect(view.result.current.list.data?.[0]?.title).toBe("new base"));
    expect(view.result.current.draft.isPending).toBe(true);
    refreshedStack.resolve({ available: true, pullRequests: [{ ...authored[0]!, title: "new stack" }], error: null });
    await waitFor(() => expect(view.result.current.list.data?.[0]?.title).toBe("new stack"));
    await waitFor(() => expect(view.result.current.draft.isSuccess).toBe(true));
    view.unmount();
    client.clear();
  });
});
