// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { normalizeThreadGroups } from "../model";
import {
  threadQueryKeys,
  threadQueryPolicies,
  saveThreadGroups,
  useArchivedThreadsQuery,
} from "../queries";

function queryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("R9 Threads query ownership", () => {
  it("keeps preferences/groups/order in typed Query and normalizes groups without importing server.ts", async () => {
    expect(
      normalizeThreadGroups({
        groups: [
          { id: "group_later", name: "Later", threadIds: ["thr_1", "thr_1"] },
        ],
      }),
    ).toEqual([{ id: "group_later", name: "Later", threadIds: ["thr_1"] }]);
    expect(threadQueryKeys.groups()).toEqual([
      "work-sidebar",
      "sidebar",
      "threads",
      "groups",
    ]);
    expect(threadQueryPolicies.groups).toMatchObject({
      staleTime: Infinity,
      retry: false,
    });
    const client = new QueryClient();
    const rpc = {
      call: async (method: string, input: unknown) => ({
        groups:
          input && method === "saveThreadGroups"
            ? (input as { groups: unknown[] }).groups
            : [],
      }),
    };
    await saveThreadGroups(client, rpc, [
      { id: "group_later", name: "Later", threadIds: ["thr_1"] },
    ]);
    expect(client.getQueryData(threadQueryKeys.groups())).toEqual([
      { id: "group_later", name: "Later", threadIds: ["thr_1"] },
    ]);
  });

  it("owns archive reads through the registered-slot lifecycle: closed, cached reopen, roster invalidation, and stable roster", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rpc = {
      call: vi.fn(async () => ({
        available: true,
        threads: [{ id: "thr_archived" }],
      })),
    };
    const view = renderHook(
      ({ enabled, roster }: { enabled: boolean; roster: string }) =>
        useArchivedThreadsQuery(rpc, enabled, roster),
      {
        initialProps: { enabled: false, roster: "thr_active" },
        wrapper: queryWrapper(client),
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(0);
    view.rerender({ enabled: true, roster: "thr_active" });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1));
    view.rerender({ enabled: false, roster: "thr_active" });
    view.rerender({ enabled: true, roster: "thr_active" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: false, roster: "thr_changed" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    view.rerender({ enabled: true, roster: "thr_changed" });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    view.rerender({ enabled: false, roster: "thr_changed" });
    view.rerender({ enabled: false, roster: "thr_changed" });
    view.rerender({ enabled: true, roster: "thr_changed" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    view.unmount();
    client.clear();
  });

  it("keeps populated archive data visible through an error and supports one explicit retry", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rpc = {
      call: vi
        .fn()
        .mockResolvedValueOnce({
          available: true,
          threads: [{ id: "thr_archived" }],
        })
        .mockRejectedValueOnce(new Error("archive unavailable"))
        .mockRejectedValueOnce(new Error("archive unavailable"))
        .mockResolvedValueOnce({
          available: true,
          threads: [{ id: "thr_retried" }],
        }),
    };
    const view = renderHook(
      ({ enabled }: { enabled: boolean }) =>
        useArchivedThreadsQuery(rpc, enabled, "stable"),
      {
        initialProps: { enabled: true },
        wrapper: queryWrapper(client),
      },
    );
    await waitFor(() =>
      expect(view.result.current.archive.data).toEqual([
        { id: "thr_archived" },
      ]),
    );
    let failed!: Awaited<
      ReturnType<typeof view.result.current.archive.refetch>
    >;
    await act(async () => {
      failed = await view.result.current.archive.refetch();
    });
    expect(failed.isError).toBe(true);
    expect(view.result.current.archive.data).toEqual([{ id: "thr_archived" }]);
    await act(async () => {
      await view.result.current.archive.refetch();
    });
    await waitFor(() =>
      expect(view.result.current.archive.data).toEqual([{ id: "thr_retried" }]),
    );
    expect(rpc.call).toHaveBeenCalledTimes(4);
    view.unmount();
    client.clear();
  });
});
