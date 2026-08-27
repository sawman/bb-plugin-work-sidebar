// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys, changesPolicies } from "../model";
import { useChanges } from "../queries";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("R13 Changes queries", () => {
  it("uses 1s visible/9s background fingerprint polling, isolates thread switches, and cleans listeners, observers, and timers", async () => {
    vi.useFakeTimers();
    const previousVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const addEventListener = vi.spyOn(document, "addEventListener");
    const removeEventListener = vi.spyOn(document, "removeEventListener");
    let fingerprint = "one";
    const rpc = {
      call: vi.fn(async (method: string, input: { threadId: string }) =>
        method === "getChanges"
          ? {
              currentPullRequest: {
                url: `https://github.com/acme/repo/pull/${input.threadId === "thr_a" ? 1 : 2}`,
              },
              stack: null,
              stackUnavailableReason: null,
              githubStack: null,
              repository: {
                outcome: "available",
                message: null,
                branch: "main",
                base: "main",
                ahead: 0,
                behind: 0,
                worktreeState: "clean",
                hasUncommittedChanges: false,
                changedFileCount: 0,
                changedInsertions: 0,
                changedDeletions: 0,
                changedFiles: [],
              },
            }
          : { fingerprint },
      ),
    };
    const client = new QueryClient({
      defaultOptions: { queries: { retry: true } },
    });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(
      ({ threadId }) =>
        useChanges(rpc as never, threadId, {
          visiblePollMs: 1_000,
          backgroundPollMs: 9_000,
        }),
      { initialProps: { threadId: "thr_a" }, wrapper },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(view.result.current.data?.currentPullRequest?.url).toContain("/1");
    fingerprint = "two";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
      await Promise.resolve();
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: changesKeys.projection("thr_a"),
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: changesKeys.projection("thr_b"),
    });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    const before = rpc.call.mock.calls.filter(
      ([method]) => method === "getChangesFingerprint",
    ).length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(8_999);
    });
    expect(
      rpc.call.mock.calls.filter(
        ([method]) => method === "getChangesFingerprint",
      ),
    ).toHaveLength(before);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(
      rpc.call.mock.calls.filter(
        ([method]) => method === "getChangesFingerprint",
      ),
    ).toHaveLength(before + 1);
    view.rerender({ threadId: "thr_b" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(invalidate).not.toHaveBeenCalledWith({
      queryKey: changesKeys.projection("thr_b"),
    });
    expect(changesPolicies.projection.retry).toBe(false);
    expect(changesPolicies.fingerprint.retry).toBe(false);

    view.unmount();
    for (const query of client.getQueryCache().findAll())
      expect(query.getObserversCount()).toBe(0);
    const visibilityAdds = addEventListener.mock.calls.filter(
      ([event]) => event === "visibilitychange",
    ).length;
    const visibilityRemoves = removeEventListener.mock.calls.filter(
      ([event]) => event === "visibilitychange",
    ).length;
    expect(visibilityAdds).toBe(1);
    expect(visibilityRemoves).toBe(visibilityAdds);
    client.clear();
    await act(async () => {
      await vi.runAllTimersAsync();
    });
    expect(vi.getTimerCount()).toBe(0);
    if (previousVisibility)
      Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
  });
});
