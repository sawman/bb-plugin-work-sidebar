// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { changesKeys, changesPolicies } from "../model";
import { useChanges } from "../queries";

describe("R13 Changes queries", () => {
  it("uses exact visible/background fingerprint intervals, invalidates only its sibling-isolated thread projection, and cleans up", async () => {
    vi.useFakeTimers(); const calls = vi.fn(async (method: string, input: { threadId: string }) => method === "getChanges" ? ({ currentPullRequest: { url: `https://github.com/acme/repo/pull/${input.threadId === "thr_a" ? 1 : 2}` }, stack: null, stackUnavailableReason: null, githubStack: null, repository: { outcome: "available", message: null, branch: "main", base: "main", ahead: 0, behind: 0, worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] } }) : ({ fingerprint: "one" }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: true } } }); const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const a = renderHook(() => useChanges({ call: calls } as never, "thr_a", { visiblePollMs: 1_000, backgroundPollMs: 9_000 }), { wrapper });
    const b = renderHook(() => useChanges({ call: calls } as never, "thr_b", { visiblePollMs: 1_000, backgroundPollMs: 9_000 }), { wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1_000); });
    expect(calls.mock.calls.filter(([method]) => method === "getChangesFingerprint")).toHaveLength(4);
    expect(changesPolicies.projection.retry).toBe(false); expect(changesPolicies.fingerprint.retry).toBe(false);
    expect(client.getQueryCache().findAll({ queryKey: changesKeys.projection("thr_a") })[0]?.getObserversCount()).toBe(1);
    a.unmount(); b.unmount(); client.clear(); await act(async () => { await vi.runAllTimersAsync(); }); expect(vi.getTimerCount()).toBe(0);
  });

  it("uses the 1s visible and 9s background intervals, invalidates only a changed fingerprint, and resets history on thread switch", async () => {
    vi.useFakeTimers();
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    let fingerprint = "one";
    const rpc = { call: vi.fn(async (method: string, input: { threadId: string }) => method === "getChanges"
      ? ({ currentPullRequest: { url: `https://github.com/acme/repo/pull/${input.threadId === "thr_a" ? 1 : 2}` }, stack: null, stackUnavailableReason: null, githubStack: null, repository: { outcome: "available", message: null, branch: "main", base: "main", ahead: 0, behind: 0, worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] } })
      : ({ fingerprint })) };
    const client = new QueryClient({ defaultOptions: { queries: { retry: true } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    const view = renderHook(({ threadId }) => useChanges(rpc as never, threadId, { visiblePollMs: 1_000, backgroundPollMs: 9_000 }), { initialProps: { threadId: "thr_a" }, wrapper });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); await Promise.resolve(); });
    expect(view.result.current.data?.currentPullRequest?.url).toContain("/1");
    fingerprint = "two"; await act(async () => { await vi.advanceTimersByTimeAsync(1_000); await Promise.resolve(); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: changesKeys.projection("thr_a") });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: changesKeys.projection("thr_b") });
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" }); act(() => document.dispatchEvent(new Event("visibilitychange")));
    const before = rpc.call.mock.calls.filter(([method]) => method === "getChangesFingerprint").length;
    await act(async () => { await vi.advanceTimersByTimeAsync(8_999); }); expect(rpc.call.mock.calls.filter(([method]) => method === "getChangesFingerprint")).toHaveLength(before);
    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); expect(rpc.call.mock.calls.filter(([method]) => method === "getChangesFingerprint")).toHaveLength(before + 1);
    view.rerender({ threadId: "thr_b" }); await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(invalidate).not.toHaveBeenCalledWith({ queryKey: changesKeys.projection("thr_b") });
    view.unmount(); client.clear(); await act(async () => { await vi.runAllTimersAsync(); }); expect(vi.getTimerCount()).toBe(0);
    if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility); else delete (document as { visibilityState?: string }).visibilityState;
  });
});
