// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackerKeys } from "../model";
import { invalidateTracker, useTracker, useTrackerMutations } from "../queries";

const trackerRpc = vi.hoisted(() => vi.fn());
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: () => ({ call: trackerRpc }) }));

afterEach(() => {
  vi.useRealTimers();
  trackerRpc.mockReset();
});

function setup(rpc = { call: vi.fn().mockResolvedValue({}) }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, rpc, hook: renderHook(() => useTrackerMutations(rpc as never, "thr_1"), { wrapper }) };
}

describe("tracker Query mutations", () => {
  it("calls each exact RPC mutation and leaves its server realtime signal as the sole invalidation owner", async () => {
    const { client, rpc, hook } = setup(); const invalidate = vi.spyOn(client, "invalidateQueries");
    await hook.result.current.link.mutateAsync("LIN-1"); await hook.result.current.primary.mutateAsync("LIN-2"); await hook.result.current.unlink.mutateAsync("LIN-1"); await hook.result.current.status.mutateAsync({ key: "LIN-1", statusId: "done" });
    expect(rpc.call.mock.calls).toEqual([["linkLinearIssue", { threadId: "thr_1", key: "LIN-1" }], ["setPrimaryLinearIssue", { threadId: "thr_1", key: "LIN-2" }], ["unlinkLinearIssue", { threadId: "thr_1", key: "LIN-1" }], ["updateLinearIssueStatus", { threadId: "thr_1", key: "LIN-1", statusId: "done" }]]);
    expect(invalidate).not.toHaveBeenCalled();
    await invalidateTracker(client, "thr_2"); expect(invalidate).toHaveBeenLastCalledWith({ queryKey: trackerKeys.context("thr_2") });
  });
});

describe("tracker Query observer lifecycle", () => {
  it("keeps a fresh cache quiet, then refreshes an active stale Work observer and stops after unmount", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-01T00:00:00Z"));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
    client.setQueryData(trackerKeys.context("thr_1"), { available: true });
    trackerRpc.mockResolvedValue({ available: true });

    const fresh = renderHook(() => useTracker("thr_1"), { wrapper });
    expect(trackerRpc).not.toHaveBeenCalled();
    fresh.unmount();
    const remounted = renderHook(() => useTracker("thr_1"), { wrapper });
    expect(trackerRpc).not.toHaveBeenCalled();
    remounted.unmount();

    vi.advanceTimersByTime(5_001);
    const stale = renderHook(() => useTracker("thr_1"), { wrapper });
    await vi.advanceTimersByTimeAsync(0);
    expect(trackerRpc).toHaveBeenCalledTimes(1);
    expect(trackerRpc).toHaveBeenLastCalledWith("getWorkTracker", { threadId: "thr_1" });

    await vi.advanceTimersByTimeAsync(30_000);
    expect(trackerRpc).toHaveBeenCalledTimes(2);
    stale.unmount();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(trackerRpc).toHaveBeenCalledTimes(2);
  });
});
