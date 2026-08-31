// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useAgentDetails } from "../queries";
import { queryPolicies } from "../../../query-runtime";

const { rpcClient } = vi.hoisted(() => ({
  rpcClient: { call: vi.fn() },
}));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal()),
  useRpc: () => rpcClient,
}));

function wrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

afterEach(() => {
  rpcClient.call.mockReset();
});

describe("Agents detail query lifecycle", () => {
  it("keeps immutable model metadata across activity updates and refetches only for a changed roster", async () => {
    expect(queryPolicies.agentDetails).toMatchObject({
      staleTime: Infinity,
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    rpcClient.call.mockImplementation(async (_method, { threadIds }) => ({
      agents: threadIds.map((threadId: string) => ({ threadId, model: "terra" })),
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ threadIds }) => useAgentDetails(threadIds),
      {
        initialProps: { threadIds: ["thr_a"] },
        wrapper: wrapper(client),
      },
    );

    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledOnce());
    view.rerender({ threadIds: ["thr_a"] });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(rpcClient.call).toHaveBeenCalledOnce();

    view.rerender({
      threadIds: ["thr_b", "thr_a", "thr_a"],
    });
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledTimes(2));
    expect(rpcClient.call).toHaveBeenLastCalledWith("getAgentDetails", {
      threadIds: ["thr_a", "thr_b"],
    });

    view.unmount();
    client.clear();
  });
});
