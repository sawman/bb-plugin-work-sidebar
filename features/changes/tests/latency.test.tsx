// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys, changesPolicies } from "../model";
import { invalidateChanges, useChanges } from "../queries";
import { pullRequestKeys } from "../../pull-requests/queries";
import { factFromPullRequest, mergePullRequestFacts } from "../../pull-requests/facts";

import { currentPr } from "./latency-fixtures";
const repo = (branch: string) => ({
  outcome: "available" as const, message: null, branch, base: "main", ahead: 0, behind: 0,
  worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0,
  changedInsertions: 0, changedDeletions: 0, changedFiles: [],
});
const summary = (number: number) => ({ currentPullRequest: currentPr(number), stack: null, stackUnavailableReason: null });
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((complete, fail) => { resolve = complete; reject = fail; });
  return { promise, resolve, reject };
}
function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}
const polling = { visiblePollMs: 60_000, backgroundPollMs: 300_000 };
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Changes independent readiness and latency", () => {
  it("cold repository and PR summary resolve before indefinitely deferred enrichment; concurrent observers dedupe", async () => {
    const slow = deferred<unknown>();
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesPullRequests") return summary(1);
      if (method === "getChangesProjection") return slow.promise;
      return { fingerprint: null };
    }) };
    const client = new QueryClient();
    const view = renderHook(() => [useChanges(rpc as never, "thr_a", polling), useChanges(rpc as never, "thr_a", polling)], { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current[0].data?.currentPullRequest?.number).toBe(1));
    expect(view.result.current[0].repository.data?.branch).toBe("A");
    expect(view.result.current[0].enrichment.isPending).toBe(true);
    for (const method of ["getChangesRepository", "getChangesPullRequests", "getChangesProjection", "getChangesFingerprint"])
      expect(rpc.call.mock.calls.filter(([name]) => name === method)).toHaveLength(1);
    slow.reject(new Error("stack offline"));
    await waitFor(() => expect(view.result.current[0].enrichment.isError).toBe(true));
    expect(view.result.current[0].data?.currentPullRequest?.number).toBe(1);
    expect(view.result.current[0].repository.data?.branch).toBe("A");
    view.unmount(); client.clear();
  });

  it("warm mount and A→B→A paint cached thread-local data synchronously; B's late reply cannot leak", async () => {
    const slowB = deferred<unknown>();
    const client = new QueryClient();
    client.setQueryData(changesKeys.repository("thr_a"), repo("A"));
    client.setQueryData(changesKeys.summary("thr_a"), summary(1));
    client.setQueryData(changesKeys.projection("thr_a"), { ...summary(1), githubStack: null });
    const rpc = { call: vi.fn(async (method: string, input: { threadId: string }) => {
      if (method === "getChangesFingerprint") return { fingerprint: null };
      if (input.threadId === "thr_b") return slowB.promise;
      throw new Error("Warm A must not refetch while fresh");
    }) };
    const view = renderHook(({ threadId }) => useChanges(rpc as never, threadId, polling), { wrapper: wrapper(client), initialProps: { threadId: "thr_a" } });
    expect(view.result.current.repository.data?.branch).toBe("A");
    expect(view.result.current.data?.currentPullRequest?.number).toBe(1);
    view.rerender({ threadId: "thr_b" });
    expect(view.result.current.repository.data).toBeUndefined();
    expect(view.result.current.data).toBeUndefined();
    view.rerender({ threadId: "thr_a" });
    expect(view.result.current.repository.data?.branch).toBe("A");
    expect(view.result.current.data?.currentPullRequest?.number).toBe(1);
    await act(async () => { slowB.resolve({ ...summary(2), githubStack: null, ...repo("B") }); });
    expect(view.result.current.repository.data?.branch).toBe("A");
    expect(view.result.current.data?.currentPullRequest?.number).toBe(1);
    expect(client.getQueryData(changesKeys.summary("thr_b"))).toBeUndefined();
    view.unmount(); client.clear();
  });

  it("late summary and enrichment cannot replace newer canonical PR facts", async () => {
    const pending = deferred<ReturnType<typeof summary>>();
    const client = new QueryClient();
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesFingerprint") return { fingerprint: null };
      return pending.promise;
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(3));
    const newer = factFromPullRequest(currentPr(1, "new manual refresh"));
    client.setQueryData(pullRequestKeys.factDirectory(), mergePullRequestFacts(undefined, [newer]));
    await act(async () => { pending.resolve(summary(1)); });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[newer.key].title).toBe("new manual refresh");
    view.unmount(); client.clear();
  });

  it("manual/realtime invalidation refreshes all stages once; stale mount refetches and finite GC removes inactive stage data", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      return { currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await invalidateChanges(client, "thr_a"); await vi.advanceTimersByTimeAsync(0); });
    for (const method of ["getChangesRepository", "getChangesPullRequests", "getChangesProjection"])
      expect(rpc.call.mock.calls.filter(([name]) => name === method)).toHaveLength(2);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(changesPolicies.projection.staleTime + 1); });
    const warm = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    expect(warm.result.current.repository.data?.branch).toBe("A");
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(rpc.call.mock.calls.filter(([name]) => name === "getChangesRepository")).toHaveLength(3);
    warm.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(changesPolicies.projection.gcTime + 1); });
    expect(client.getQueryData(changesKeys.repository("thr_a"))).toBeUndefined();
    expect(client.getQueryData(changesKeys.summary("thr_a"))).toBeUndefined();
    expect(client.getQueryData(changesKeys.projection("thr_a"))).toBeUndefined();
    client.clear();
    expect(vi.getTimerCount()).toBe(0);
  });
});
