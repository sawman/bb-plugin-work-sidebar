// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  pullRequestKeys,
  pullRequestPolicies,
  useAuthoredPullRequests,
  useAuthoredPullRequestRefresh,
  useSetAuthoredPullRequestDraft,
  useThreadPullRequestChanges,
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

describe("R5 pull-request queries", () => {
  afterEach(() => vi.useRealTimers());

  it("shares authored PR list and stack cache across left/right consumers, supports manual refresh, and filters no client records", async () => {
    let reads = 0;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "sidebarAuthoredPullRequests") { reads += 1; return { available: true, pullRequests: authored, error: null }; }
        if (method === "sidebarAuthoredPullRequestStacks") return { available: true, pullRequests: authored, error: null };
        if (method === "getGitHubApiHealth") return { state: "available", scope: "unknown", message: null, retryAt: null };
        throw new Error(`unexpected ${method}`);
      }),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const left = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    const right = renderHook(() => useAuthoredPullRequests(rpc), { wrapper: wrapper(client) });
    await waitFor(() => expect(left.result.current.data).toEqual(authored));
    expect(right.result.current.data).toEqual(authored);
    expect(reads).toBe(1);
    expect(client.getQueryData(pullRequestKeys.authored())).toEqual(authored);
    expect(pullRequestPolicies.authored.refetchInterval({ intervalMs: 7_000 })).toBe(7_000);

    const refresh = renderHook(() => useAuthoredPullRequestRefresh(), { wrapper: wrapper(client) });
    await act(async () => { await refresh.result.current(); });
    await waitFor(() => expect(reads).toBe(2));
    left.unmount();
    right.unmount();
    refresh.unmount();
    client.clear();
  });

  it("uses declarative visible/background polling, leaves no observers after unmount, and never retries a classified rate limit", async () => {
    vi.useFakeTimers();
    let fingerprintReads = 0;
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "getThreadPullRequestChanges") return { currentPullRequest: { url: "https://github.com/acme/sidebar/pull/12" }, stack: null, stackUnavailableReason: null, githubStack: null };
        if (method === "getPullRequestFingerprint") { fingerprintReads += 1; throw Object.assign(new Error("GitHub API is rate limited."), { code: "github_rate_limited" }); }
        throw new Error(`unexpected ${method}`);
      }),
    };
    const client = new QueryClient({ defaultOptions: { queries: { retry: 3 } } });
    const view = renderHook(() => useThreadPullRequestChanges(rpc, "thr_r5", {
      visiblePollMs: 1_000,
      backgroundPollMs: 9_000,
      isVisible: () => true,
    }), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    expect(view.result.current.data?.currentPullRequest?.url).toContain("/12");
    await vi.advanceTimersByTimeAsync(1_000);
    // One immediate observation and exactly one visible-policy interval;
    // the rate-limit error itself is not retried by the client.
    expect(fingerprintReads).toBe(2);
    expect(pullRequestPolicies.threadChanges.retry).toBe(false);
    expect(pullRequestPolicies.fingerprint.refetchInterval({ visiblePollMs: 1_000, backgroundPollMs: 9_000, isVisible: () => false })).toBe(9_000);
    view.unmount();
    expect(client.getQueryCache().findAll({ queryKey: pullRequestKeys.threadChanges("thr_r5") })[0]?.getObserversCount()).toBe(0);
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
    }) };
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
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: ["work-sidebar", "work"] });
    mutation.unmount();
    client.clear();
  });
});
