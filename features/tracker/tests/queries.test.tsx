// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { trackerKeys } from "../model";
import { invalidateTracker, useTrackerMutations } from "../queries";

function setup(rpc = { call: vi.fn().mockResolvedValue({}) }) {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, rpc, hook: renderHook(() => useTrackerMutations(rpc as never, "thr_1"), { wrapper }) };
}

describe("tracker Query mutations", () => {
  it("calls each exact RPC mutation and leaves its server realtime signal as the sole invalidation owner", async () => {
    const { client, rpc, hook } = setup(); const invalidate = vi.spyOn(client, "invalidateQueries");
    await hook.result.current.link.mutateAsync("LIN-1"); await hook.result.current.unlink.mutateAsync(); await hook.result.current.status.mutateAsync("done");
    expect(rpc.call.mock.calls).toEqual([["linkLinearIssue", { threadId: "thr_1", key: "LIN-1" }], ["unlinkLinearIssue", { threadId: "thr_1" }], ["updateLinearIssueStatus", { threadId: "thr_1", statusId: "done" }]]);
    expect(invalidate).not.toHaveBeenCalled();
    await invalidateTracker(client, "thr_2"); expect(invalidate).toHaveBeenLastCalledWith({ queryKey: trackerKeys.context("thr_2") });
  });
});
