// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import { createElement, type PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryKeys } from "../../../query-runtime";
import { trackerKeys } from "../../tracker/model";
import { normalizeThreadGroups } from "../model";
import {
  threadQueryKeys,
  threadQueryPolicies,
  saveThreadGroups,
  saveSidebarAppearance,
  useArchivedThreadsQuery,
  useThreadHierarchyMutation,
  type ThreadsRpc,
} from "../queries";

function queryWrapper(client: QueryClient) {
  return function QueryWrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("R9 Threads query ownership", () => {
  it("round-trips text scale through the shared typed appearance query", async () => {
    const client = new QueryClient();
    const rpc = {
      call: vi.fn(async (method: string, input: unknown) => {
        expect(method).toBe("saveSidebarAppearance");
        expect(input).toEqual({ textScale: 1.1 });
        return { rowHeight: 40, textScale: 1.1 };
      }),
    };
    await expect(
      saveSidebarAppearance(
        client,
        rpc as unknown as ThreadsRpc,
        { textScale: 1.1 },
      ),
    ).resolves.toEqual({ rowHeight: 40, textScale: 1.1 });
    expect(client.getQueryData(threadQueryKeys.appearance())).toEqual({
      rowHeight: 40,
      textScale: 1.1,
    });
    client.clear();
  });

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
    await saveThreadGroups(client, rpc as unknown as ThreadsRpc, [
      { id: "group_later", name: "Later", threadIds: ["thr_1"] },
    ]);
    expect(client.getQueryData(threadQueryKeys.groups())).toEqual({
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_1"] },
      ],
      activeGroupPosition: 0,
    });
  });

  it("caches archive reads while collapsed and refreshes them when the active roster changes", async () => {
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
      ({ roster }: { roster: string }) =>
        useArchivedThreadsQuery(rpc as unknown as ThreadsRpc, roster),
      {
        initialProps: { roster: "thr_active" },
        wrapper: queryWrapper(client),
      },
    );
    await act(async () => {
      await Promise.resolve();
    });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(1));
    view.rerender({ roster: "thr_active" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    view.rerender({ roster: "thr_active" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(1);
    view.rerender({ roster: "thr_changed" });
    await waitFor(() => expect(rpc.call).toHaveBeenCalledTimes(2));
    view.rerender({ roster: "thr_changed" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(rpc.call).toHaveBeenCalledTimes(2);
    view.rerender({ roster: "thr_changed" });
    view.rerender({ roster: "thr_changed" });
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
      () => useArchivedThreadsQuery(rpc as unknown as ThreadsRpc, "stable"),
      {
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

  it("reroots every affected Work projection and refreshes the shared task families", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const rpc = {
      call: vi.fn(async () => ({
        threadId: "thr_child",
        parentThreadId: null,
        oldRootThreadId: "thr_root",
        newRootThreadId: "thr_child",
        affectedThreadIds: ["thr_child", "thr_nested"],
      })),
    };
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const view = renderHook(
      () => useThreadHierarchyMutation(rpc as unknown as ThreadsRpc),
      { wrapper: queryWrapper(client) },
    );

    await act(async () => {
      await view.result.current.mutateAsync({
        threadId: "thr_child",
        parentThreadId: null,
      });
    });

    expect(rpc.call).toHaveBeenCalledWith("moveSidebarThread", {
      threadId: "thr_child",
      parentThreadId: null,
    });
    const workKeys = (threadId: string) => [
      queryKeys.work.status(threadId),
      queryKeys.work.activity(threadId),
      queryKeys.work.backgroundJobs(threadId),
      queryKeys.work.outcome(threadId),
      queryKeys.work.goal(threadId),
      queryKeys.work.plan(threadId),
      queryKeys.work.providerHealth(threadId),
      trackerKeys.context(threadId),
    ];
    expect(invalidate.mock.calls).toEqual([
      [{ queryKey: threadQueryKeys.root }],
      ...workKeys("thr_child").map((queryKey) => [{ queryKey }]),
      ...workKeys("thr_nested").map((queryKey) => [{ queryKey }]),
      [{ queryKey: queryKeys.sidebar.tasks.list() }],
      [{ queryKey: queryKeys.sidebar.tasks.links() }],
    ]);
  });
});
