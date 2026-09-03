// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  WORK_CARD_REFRESH_MS,
  invalidateWorkProviderHealth,
  useWorkItemQueue,
  useWorkOutcomeMutation,
  useWorkPlan,
  useWorkProviderHealth,
  useWorkStatus,
} from "../queries";

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

describe("work-context provider health query", () => {
  afterEach(() => vi.useRealTimers());

  it("waits for the provider/environment identity instead of fetching per thread", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => useWorkProviderHealth("thr_health"), {
      wrapper: wrapper(client),
    });

    await act(async () => { await Promise.resolve(); });
    expect(rpcClient.call).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });

  it("shares one provider/environment read and refreshes it every visible minute", async () => {
    vi.useFakeTimers();
    const previousVisibility = Object.getOwnPropertyDescriptor(document, "visibilityState");
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    rpcClient.call.mockImplementation(async () => ({
        tone: "green",
        providerId: "codex",
        providerName: "Codex",
        statusUrl: null,
        status: "ready",
        message: null,
      }));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const view = renderHook(() => ({
      first: useWorkProviderHealth("thr_health", {
        providerId: "codex",
      }),
      second: useWorkProviderHealth("thr_other", {
        providerId: "codex",
      }),
    }), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(1);
    expect(rpcClient.call).toHaveBeenCalledWith("getWorkProviderStatus", {
      providerId: "codex",
    });

    await act(async () => {
      await invalidateWorkProviderHealth(client, {
        providerId: "codex",
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(3);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(3);

    view.unmount();
    client.clear();
    if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
  });
});

describe("work item queue query", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes every 30 seconds only while the Work tab observes it", async () => {
    vi.useFakeTimers();
    rpcClient.call.mockReset();
    rpcClient.call.mockResolvedValue({
      rootThreadId: "thr_work_items",
      configured: true,
      queue: { current: null, backlog: [] },
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(() => useWorkItemQueue("thr_work_items"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(rpcClient.call).toHaveBeenCalledWith("getWorkItemQueue", {
      threadId: "thr_work_items",
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(2);
    client.clear();
  });
});

describe("visible Work-card query cadence", () => {
  afterEach(() => vi.useRealTimers());

  it("refreshes durable cards on the shared cadence and stops after unmount", async () => {
    vi.useFakeTimers();
    rpcClient.call.mockReset();
    const plan = vi.fn(() => ({ items: [] }));
    const status = vi.fn(() => ({
      rootThreadId: "thr_work_cards",
      currentThread: { id: "thr_work_cards", title: "Work cards", status: "idle" },
      children: [],
    }));
    rpcClient.call.mockImplementation((method) => {
      if (method === "getWorkPlan") return Promise.resolve(plan());
      if (method === "getWorkStatus") return Promise.resolve(status());
      throw new Error(`Unexpected RPC ${method}`);
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const view = renderHook(
      () => ({
        plan: useWorkPlan("thr_work_cards"),
        status: useWorkStatus("thr_work_cards", { poll: true }),
      }),
      { wrapper: wrapper(client) },
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(plan).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORK_CARD_REFRESH_MS);
    });
    expect(plan).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);

    view.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(WORK_CARD_REFRESH_MS);
    });
    expect(plan).toHaveBeenCalledTimes(2);
    expect(status).toHaveBeenCalledTimes(2);
    client.clear();
  });
});

describe("R32.2 outcome creation query", () => {
  it("forwards an optional mapped priority and invalidates only the outcome query", async () => {
    rpcClient.call.mockResolvedValue({ task: { id: "task_outcome" } });
    const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const hook = renderHook(() => useWorkOutcomeMutation("thr_priority"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await hook.result.current.create.mutateAsync({
        title: "Create from Linear",
        priority: "high",
      });
    });

    expect(rpcClient.call).toHaveBeenCalledWith("createWorkTask", {
      threadId: "thr_priority",
      title: "Create from Linear",
      description: "Created from the Work sidebar.",
      parentTaskId: null,
      priority: "high",
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ["work-sidebar", "work", "outcome", "thr_priority"],
    });
    hook.unmount();
    client.clear();
  });
});
