// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys, changesPolicies } from "../model";
import { invalidateChanges, useChanges } from "../queries";
import { pullRequestKeys } from "../../pull-requests/queries";
import { factFromPullRequest, mergePullRequestFacts } from "../../pull-requests/facts";
import { prObservations } from "../../../tests/fixtures/pr-observation";

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

  it("a freshly hydrated unrelated PR cannot suppress a new summary for an older canonical PR", async () => {
    const client = new QueryClient();
    const olderA = factFromPullRequest(currentPr(1, "old A"));
    const freshB = factFromPullRequest(currentPr(2, "fresh B"));
    // Legacy facts with no per-record freshness must be treated as old, even
    // though another PR makes the directory-level dataUpdatedAt recent.
    client.setQueryData(pullRequestKeys.factDirectory(), { facts: { [olderA.key]: olderA }, threadFactKeys: {} });
    client.setQueryData(pullRequestKeys.factDirectory(), (current: any) => mergePullRequestFacts(current, [freshB]));
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesFingerprint") return { fingerprint: null };
      return { ...summary(1), currentPullRequest: currentPr(1, "new A"), githubStack: null };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[olderA.key].title).toBe("new A");
    view.unmount(); client.clear();
  });

  it("fresh A survives an initial stale summary, while explicit refresh publishes a newer authoritative A and clear removes metadata", async () => {
    const client = new QueryClient();
    const fresh = factFromPullRequest({ ...currentPr(1, "fresh A"), observations: prObservations(200) });
    client.setQueryData(pullRequestKeys.factDirectory(), mergePullRequestFacts(undefined, [fresh]));
    let title = "initial stale summary";
    let validation = 100;
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesFingerprint") return { fingerprint: null };
      return { ...summary(1), currentPullRequest: { ...currentPr(1, title), observations: prObservations(validation) }, githubStack: null };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[fresh.key].title).toBe("fresh A");
    title = "manual authoritative update";
    validation = 300;
    await act(async () => { await invalidateChanges(client, "thr_a"); });
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[fresh.key].title).toBe(title);
    view.unmount(); client.clear();
    expect(client.getQueryData(pullRequestKeys.factDirectory())).toBeUndefined();
  });

  it("late summary and enrichment cannot replace newer canonical PR facts", async () => {
    const pending = deferred<Omit<ReturnType<typeof summary>, "currentPullRequest"> & { currentPullRequest: import("../../pull-requests/schemas").PullRequestContract }>();
    const client = new QueryClient();
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesFingerprint") return { fingerprint: null };
      return pending.promise;
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(3));
    const newer = factFromPullRequest({ ...currentPr(1, "new manual refresh"), observations: prObservations(200) });
    client.setQueryData(pullRequestKeys.factDirectory(), mergePullRequestFacts(undefined, [newer]));
    await act(async () => { pending.resolve({ ...summary(1), currentPullRequest: { ...currentPr(1), observations: prObservations(100) } }); });
    await waitFor(() => expect(view.result.current.isPending).toBe(false));
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[newer.key].title).toBe("new manual refresh");
    view.unmount(); client.clear();
  });

  it("a cancelled old server epoch cannot publish after the replacement epoch through the actual summary Query", async () => {
    const old = deferred<Omit<ReturnType<typeof summary>, "currentPullRequest"> & { currentPullRequest: import("../../pull-requests/schemas").PullRequestContract }>();
    const client = new QueryClient();
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesFingerprint") return { fingerprint: null };
      if (method === "getChangesPullRequests") return old.promise;
      return { ...summary(1), githubStack: null };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledWith("getChangesPullRequests", { threadId: "thr_a" }));
    await act(async () => { await client.cancelQueries({ queryKey: changesKeys.summary("thr_a") }); });
    const observations = Object.fromEntries(Object.entries(prObservations(100)).map(([group, clock]) => [group, { ...clock, sequence: 1, epoch: "replacement" }]));
    const replacement = factFromPullRequest({ ...currentPr(1, "Replacement epoch"), observations });
    act(() => client.setQueryData(pullRequestKeys.factDirectory(), mergePullRequestFacts(undefined, [replacement])));
    const retiredObservations = Object.fromEntries(Object.entries(prObservations(999)).map(([group, clock]) => [group, { ...clock, sequence: 999, epoch: "retired" }]));
    await act(async () => { old.resolve({ ...summary(1), currentPullRequest: { ...currentPr(1, "Late retired epoch"), observations: retiredObservations } }); });
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[replacement.key].title).toBe("Replacement epoch");
    expect(client.getQueryData(changesKeys.summary("thr_a"))).toBeUndefined();
    view.unmount(); client.clear();
  });

  it("a late old-thread fingerprint cannot reset the new thread baseline or invalidate its repository", async () => {
    vi.useFakeTimers();
    const client = new QueryClient();
    for (const [threadId, number] of [["thr_a", 1], ["thr_b", 2]] as const) {
      client.setQueryData(changesKeys.repository(threadId), repo(threadId));
      client.setQueryData(changesKeys.summary(threadId), summary(number));
      client.setQueryData(changesKeys.projection(threadId), { ...summary(number), githubStack: null });
    }
    const lateA = deferred<{ fingerprint: string }>();
    let fingerprintB = "B1";
    const rpc = { call: vi.fn(async (method: string, input: { threadId: string }) => {
      if (method === "getChangesFingerprint") return input.threadId === "thr_a" ? lateA.promise : { fingerprint: fingerprintB };
      if (method === "getChangesRepository") return repo(input.threadId);
      return { ...summary(input.threadId === "thr_a" ? 1 : 2), githubStack: null };
    }) };
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(({ threadId }) => useChanges(rpc as never, threadId, { visiblePollMs: 1_000, backgroundPollMs: 1_000 }), { wrapper: wrapper(client), initialProps: { threadId: "thr_a" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    view.rerender({ threadId: "thr_b" });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { lateA.resolve({ fingerprint: "lateA" }); await vi.advanceTimersByTimeAsync(0); });
    fingerprintB = "B2";
    await act(async () => { await vi.advanceTimersByTimeAsync(1_001); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: changesKeys.repository("thr_b") });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: changesKeys.repository("thr_a") });
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
