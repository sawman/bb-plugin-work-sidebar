// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, act, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys, changesPolicies } from "../model";
import type { Changes } from "../schemas";
import {
  invalidateChanges,
  useChanges,
  useWorkingTreeFileDiff,
} from "../queries";

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("R13 Changes queries", () => {
  it("renders a cached projection immediately while a stale refresh is in flight", async () => {
    let resolve!: (value: Changes) => void;
    const refreshed = new Promise<Changes>((next) => {
      resolve = next;
    });
    const threadId = "thr_cached_projection";
    const cached: Changes = {
      currentPullRequest: null,
      stack: null,
      stackUnavailableReason: null,
      githubStack: null,
      repository: {
        outcome: "available",
        message: null,
        branch: "cached-branch",
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
    };
    const rpc = { call: vi.fn(() => refreshed) };
    const client = new QueryClient();
    client.setQueryData<Changes>(changesKeys.projection(threadId), cached);
    await client.invalidateQueries({
      queryKey: changesKeys.projection(threadId),
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(
      () =>
        useChanges(rpc as never, threadId, {
          visiblePollMs: 1_000,
          backgroundPollMs: 9_000,
        }),
      { wrapper },
    );

    expect(view.result.current.data).toBe(cached);
    expect(view.result.current.isPending).toBe(false);
    await waitFor(() => expect(view.result.current.isFetching).toBe(true));

    resolve(cached);
    await waitFor(() => expect(view.result.current.isFetching).toBe(false));
    view.unmount();
  });

  it("invalidates only the Changes projection, leaving fingerprint and file diff caches fresh", async () => {
    const client = new QueryClient();
    const threadId = "thr_projection";
    const fingerprintKey = changesKeys.fingerprint(
      threadId,
      "https://github.com/acme/repo/pull/1",
    );
    const fileDiffKey = changesKeys.fileDiff(threadId, "same", "src/file.ts");
    client.setQueryData(changesKeys.projection(threadId), { currentPullRequest: null });
    client.setQueryData(fingerprintKey, { fingerprint: "same" });
    client.setQueryData(fileDiffKey, {
      kind: "patch",
      path: "src/file.ts",
      patch: "@@ -1 +1 @@",
      message: null,
    });

    await invalidateChanges(client, threadId);

    expect(
      client.getQueryCache().find({ queryKey: changesKeys.projection(threadId) })
        ?.state.isInvalidated,
    ).toBe(true);
    expect(client.getQueryCache().find({ queryKey: fingerprintKey })?.state.isInvalidated).toBe(false);
    expect(client.getQueryCache().find({ queryKey: fileDiffKey })?.state.isInvalidated).toBe(false);
  });

  it("moves a changed fingerprint to one new diff key without refetching the old key", async () => {
    vi.useFakeTimers();
    const previousVisibility = Object.getOwnPropertyDescriptor(
      document,
      "visibilityState",
    );
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    const threadId = "thr_transition";
    const url = "https://github.com/acme/repo/pull/1";
    let currentFingerprint = "one";
    const fileDiffCalls: string[] = [];
    const rpc = {
      call: vi.fn(async (method: string) => {
        if (method === "getChangesFingerprint")
          return { fingerprint: currentFingerprint };
        if (method === "getWorkingTreeFileDiff") {
          fileDiffCalls.push(currentFingerprint);
          return {
            kind: "patch" as const,
            path: "src/file.ts",
            patch: `fingerprint:${currentFingerprint}`,
            message: null,
          };
        }
        throw new Error(`Unexpected RPC method: ${method}`);
      }),
    };
    const client = new QueryClient();
    client.setQueryData(changesKeys.projection(threadId), {
      currentPullRequest: { url },
    });
    client.setQueryData(changesKeys.fingerprint(threadId, url), {
      fingerprint: "one",
    });
    client.setQueryData(changesKeys.fileDiff(threadId, "one", "src/file.ts"), {
      kind: "patch",
      path: "src/file.ts",
      patch: "fingerprint:one",
      message: null,
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const view = renderHook(() => {
      const changes = useChanges(rpc as never, threadId, {
        visiblePollMs: 1_000,
        backgroundPollMs: 9_000,
      });
      const diff = useWorkingTreeFileDiff(
        rpc as never,
        threadId,
        changes.fingerprint.data?.fingerprint ?? null,
        "src/file.ts",
      );
      return { changes, diff };
    }, { wrapper });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    currentFingerprint = "two";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_001);
      await Promise.resolve();
      await Promise.resolve();
    });

    view.unmount();
    if (previousVisibility)
      Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
    expect(view.result.current.changes.fingerprint.data?.fingerprint).toBe("two");
    expect(fileDiffCalls).toEqual(["two"]);
    expect(client.getQueryCache().find({
      queryKey: changesKeys.fileDiff(threadId, "one", "src/file.ts"),
    })?.state.isInvalidated).toBe(false);
    expect(client.getQueryCache().find({
      queryKey: changesKeys.fileDiff(threadId, "two", "src/file.ts"),
    })?.state.data).toMatchObject({ patch: "fingerprint:two" });
  });

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
