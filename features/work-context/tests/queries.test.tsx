// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement, type PropsWithChildren } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useWorkProviderHealth } from "../queries";

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

  it("polls once per visible 30-second interval and stops while the document is hidden", async () => {
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
    const view = renderHook(() => useWorkProviderHealth("thr_health"), {
      wrapper: wrapper(client),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(2);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    act(() => document.dispatchEvent(new Event("visibilitychange")));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(rpcClient.call).toHaveBeenCalledTimes(2);

    view.unmount();
    client.clear();
    if (previousVisibility) Object.defineProperty(document, "visibilityState", previousVisibility);
    else delete (document as { visibilityState?: string }).visibilityState;
  });
});
