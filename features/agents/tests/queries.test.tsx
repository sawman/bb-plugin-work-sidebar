// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AGENT_DETAIL_DIRECTORY_MAX,
  invalidateAgentDetails,
  useAgentDetails,
} from "../queries";
import { queryKeys, queryPolicies } from "../../../query-runtime";

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
  it("normalizes roster permutations into one finite directory query", async () => {
    expect(queryPolicies.agentDetails).toMatchObject({
      staleTime: Infinity,
      gcTime: expect.any(Number),
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    });
    expect(queryPolicies.agentDetails.gcTime).toBeGreaterThan(0);
    expect(queryPolicies.agentDetails.gcTime).toBeLessThan(Infinity);
    rpcClient.call.mockImplementation(async (_method, { threadIds }) => ({
      agents: threadIds.map((threadId: string) => ({ threadId, model: "terra" })),
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      ({ threadIds }) => useAgentDetails(threadIds),
      {
        initialProps: { threadIds: ["thr_b", "thr_a", "thr_a"] },
        wrapper: wrapper(client),
      },
    );

    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledOnce());
    expect(rpcClient.call).toHaveBeenLastCalledWith("getAgentDetails", {
      threadIds: ["thr_a", "thr_b"],
    });
    view.rerender({ threadIds: ["thr_a", "thr_b"] });
    await waitFor(() => expect(view.result.current.isSuccess).toBe(true));
    expect(rpcClient.call).toHaveBeenCalledOnce();
    expect(client.getQueryCache().findAll({
      queryKey: queryKeys.agents.directory(),
    })).toHaveLength(1);
    expect(client.getQueryData(queryKeys.agents.directory())).toMatchObject({
      facts: {
        thr_a: { model: "terra" },
        thr_b: { model: "terra" },
      },
    });

    view.unmount();
    await waitFor(() => expect(client.getQueryData(queryKeys.agents.directory())).toEqual({ facts: {} }));
    client.clear();
  });

  it("shares facts across mounted panels, batches only misses, and reconciles removed children", async () => {
    rpcClient.call.mockImplementation(async (_method, { threadIds }) => ({
      agents: threadIds.map((threadId: string) => ({ threadId, model: `model-${threadId}` })),
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const first = renderHook(
      ({ threadIds }) => useAgentDetails(threadIds),
      { initialProps: { threadIds: ["thr_a", "thr_b"] }, wrapper: wrapper(client) },
    );
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledOnce());
    const second = renderHook(
      ({ threadIds }) => useAgentDetails(threadIds),
      { initialProps: { threadIds: ["thr_b", "thr_c"] }, wrapper: wrapper(client) },
    );
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledTimes(2));
    expect(rpcClient.call).toHaveBeenLastCalledWith("getAgentDetails", {
      threadIds: ["thr_c"],
    });

    first.rerender({ threadIds: ["thr_a"] });
    second.unmount();
    await waitFor(() => expect(client.getQueryData(queryKeys.agents.directory())).toEqual({
      facts: { thr_a: { model: "model-thr_a" } },
    }));
    expect(rpcClient.call).toHaveBeenCalledTimes(2);
    first.unmount();
    await waitFor(() => expect(client.getQueryData(queryKeys.agents.directory())).toEqual({ facts: {} }));

    client.clear();
  });

  it("caps the normalized directory while retaining the current roster", async () => {
    expect(AGENT_DETAIL_DIRECTORY_MAX).toBeGreaterThanOrEqual(100);
    const roster = Array.from({ length: AGENT_DETAIL_DIRECTORY_MAX + 2 }, (_, index) =>
      `thr_${String(index).padStart(3, "0")}`,
    );
    rpcClient.call.mockImplementation(async (_method, { threadIds }) => ({
      agents: threadIds.map((threadId: string) => ({ threadId, model: "terra" })),
    }));
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useAgentDetails(roster), { wrapper: wrapper(client) });
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalled());
    await waitFor(() => {
      const directory = client.getQueryData<{ facts: Record<string, unknown> }>(
        queryKeys.agents.directory(),
      );
      expect(Object.keys(directory?.facts ?? {})).toHaveLength(AGENT_DETAIL_DIRECTORY_MAX);
    });
    view.unmount();
    client.clear();
  });

  it("clears and refetches only the shared directory for an explicit refresh", async () => {
    rpcClient.call.mockResolvedValue({
      agents: [{ threadId: "thr_refresh", model: "fresh-model" }],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => useAgentDetails(["thr_refresh"]),
      { wrapper: wrapper(client) },
    );
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledOnce());
    const invalidate = vi.spyOn(client, "invalidateQueries");

    await invalidateAgentDetails(client);
    await waitFor(() => expect(rpcClient.call).toHaveBeenCalledTimes(2));
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.agents.directory(),
      refetchType: "none",
    });
    expect(client.getQueryCache().findAll({
      queryKey: queryKeys.agents.directory(),
    })).toHaveLength(1);

    view.unmount();
    client.clear();
  });
});
