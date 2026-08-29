// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import {
  getPluginQueryClient,
  queryKeys,
  queryPolicies,
} from "../../query-runtime";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { changesKeys } from "../../features/changes/model";

describe("R2 app registration and Query lifecycle", () => {
  it("preserves every current slot registration and routes both mounted slots through one module client", async () => {
    const app = await loadPluginApp(() => import("../../app"));

    expect(app.settingsSections.map(({ id }) => id)).toEqual([
      "sidebar-appearance",
      "github-polling",
    ]);
    expect(app.threadLists.map(({ id }) => id)).toEqual(["work-queue"]);
    expect(app.threadPanelActions.map(({ id }) => id)).toEqual([
      "work-context",
    ]);
    expect(app.threadHeaderActions.map(({ id }) => id)).toEqual([
      "work-context-header",
    ]);
    expect(app.composerCustomizations.map(({ id }) => id)).toEqual([
      "task-first",
    ]);

    expect(getPluginQueryClient()).toBe(getPluginQueryClient());
    expect(queryKeys.sidebar.order()).toEqual([
      "work-sidebar",
      "sidebar",
      "order",
    ]);
    expect(queryKeys.sidebar.tasks.list()).toEqual([
      "work-sidebar",
      "sidebar",
      "tasks",
      "list",
    ]);
    expect(queryKeys.sidebar.tasks.links()).toEqual([
      "work-sidebar",
      "sidebar",
      "tasks",
      "links",
    ]);
    expect(queryKeys.work.status("thr_test")).toEqual([
      "work-sidebar",
      "work",
      "status",
      "thr_test",
    ]);
    expect(queryPolicies.sidebarOrderPreferences).toMatchObject({
      staleTime: Infinity,
      gcTime: 30 * 60_000,
      retry: false,
    });
    expect(queryPolicies.sidebarTasksList).toMatchObject({
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      retry: 1,
    });
    expect(queryPolicies.sidebarTaskLinks).toMatchObject({
      staleTime: 15_000,
      gcTime: 10 * 60_000,
      retry: 1,
    });
    expect(queryPolicies.workContext).toMatchObject({
      staleTime: 5_000,
      gcTime: 10 * 60_000,
      retry: 1,
    });
    // The harness mounts slots independently, matching BB's left/right slot
    // ownership. R5 and R6 make both PR and Tasks consumers real observers on
    // the same module-generation QueryClient.
    const client = getPluginQueryClient();
    const mount = vi.spyOn(client, "mount");
    const unmount = vi.spyOn(client, "unmount");
    const left = renderSlot(app.threadLists[0]!, {
      activeThreadId: null,
      activeProjectId: null,
      isCompactViewport: false,
      onNavigate: () => undefined,
      searchQuery: "",
      Original: () => null,
    }, {
      rpc: {
        getSidebarAppearance: () => ({ rowHeight: 40, textScale: 0.9 }),
      } as never,
    });
    const right = renderSlot(app.threadPanelActions[0]!, {
      threadId: "thr_test",
      params: null,
    }, {
      rpc: {
        getSidebarAppearance: () => ({ rowHeight: 40, textScale: 0.9 }),
      } as never,
    });
    expect(
      ["Threads", "Tasks", "PRs"].map((name) =>
        Boolean(left.getByRole("button", { name }).closest(".ws-list")),
      ),
    ).toEqual([true, true, true]);
    const leftRoot = left.container.querySelector<HTMLElement>(".ws-list");
    await waitFor(() =>
      expect(leftRoot?.style.getPropertyValue("--ws-text-scale")).toBe("0.9"),
    );
    expect(leftRoot?.querySelector(":scope > .ws-tabs-sticky")).toBeTruthy();
    expect(leftRoot?.querySelector(":scope > .ws-list-toolbar")).toBeTruthy();
    expect(leftRoot?.querySelector(":scope > .ws-view-content")).toBeTruthy();
    expect(
      leftRoot?.querySelector(".ws-tabs-sticky .ws-view-content"),
    ).toBeNull();
    expect(
      leftRoot?.querySelector(".ws-list-toolbar .ws-view-content"),
    ).toBeNull();
    expect(
      ["Work", "Changes", "Agents"].map((name) =>
        right.getByRole("tab", { name }).getAttribute("aria-controls"),
      ),
    ).toEqual([
      "ws-work-thr_test-panel-work",
      "ws-work-thr_test-panel-changes",
      "ws-work-thr_test-panel-agents",
    ]);
    expect(right.container.querySelectorAll(".ws-panel-body")).toHaveLength(3);
    await waitFor(() =>
      expect(
        right.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("0.9"),
    );
    expect(mount).toHaveBeenCalledTimes(2);
    // Changes owns no cache entries until its tab mounts the panel; once
    // selected, the file query remains hook-stable and disabled until opened.
    expect(client.getQueryCache().getAll()).toHaveLength(18);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ["work-sidebar", "sidebar", "threads", "order"] })
        ?.getObserversCount(),
    ).toBe(1);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: ["work-sidebar", "sidebar", "threads", "groups"] })
        ?.getObserversCount(),
    ).toBe(1);
    expect(
      client
        .getQueryCache()
        .find({
          queryKey: ["work-sidebar", "sidebar", "threads", "appearance"],
        })
        ?.getObserversCount(),
    ).toBe(2);
    const saveAppearance = vi.fn(() => ({ rowHeight: 40, textScale: 1.1 }));
    const settings = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getSidebarAppearance: () => ({ rowHeight: 40, textScale: 0.9 }),
          saveSidebarAppearance: saveAppearance,
        } as never,
      },
    );
    fireEvent.change(settings.getByRole("spinbutton", { name: "Text scale" }), {
      target: { value: "1.1" },
    });
    await waitFor(() =>
      expect(saveAppearance).toHaveBeenCalledWith({ textScale: 1.1 }),
    );
    await waitFor(() => {
      expect(leftRoot?.style.getPropertyValue("--ws-text-scale")).toBe("1.1");
      expect(
        right.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.1");
    });
    settings.unmount();
    expect(
      client
        .getQueryCache()
        .findAll({
          queryKey: ["work-sidebar", "pull-requests", "authored", "stacks"],
        })[0]
        ?.getObserversCount(),
    ).toBe(1);
    expect(
      client
        .getQueryCache()
        .findAll({ queryKey: ["work-sidebar", "pull-requests", "health"] })[0]
        ?.getObserversCount(),
    ).toBe(1);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: queryKeys.sidebar.tasks.list() })
        ?.getObserversCount(),
    ).toBe(2);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: queryKeys.sidebar.tasks.links() })
        ?.getObserversCount(),
    ).toBe(1);
    expect(
      client
        .getQueryCache()
        .find({ queryKey: changesKeys.projection("thr_test") })
        ?.getObserversCount() ?? 0,
    ).toBe(0);
    expect(
      right.inspection.rpcCalls.filter((call) => call.method === "getChanges"),
    ).toHaveLength(0);
    left.unmount();
    right.unmount();
    expect(unmount).toHaveBeenCalledTimes(3);
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.getObserversCount() === 0),
      ).toBe(true),
    );
    client.clear();
    expect(client.getQueryCache().getAll()).toEqual([]);
  });

  it("keeps exact slot composition through repeated independent slot lifecycles", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    const client = getPluginQueryClient();
    client.clear();
    const mount = vi.spyOn(client, "mount");
    const unmount = vi.spyOn(client, "unmount");
    const priorMounts = mount.mock.calls.length;
    const priorUnmounts = unmount.mock.calls.length;

    for (let generation = 0; generation < 2; generation += 1) {
      const left = renderSlot(app.threadLists[0]!, {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => null,
      });
      const right = renderSlot(app.threadPanelActions[0]!, {
        threadId: `thr_generation_${generation}`,
        params: null,
      });
      expect(app.threadLists).toHaveLength(1);
      expect(app.threadPanelActions).toHaveLength(1);
      expect(app.threadHeaderActions).toHaveLength(1);
      left.lifecycle.unmount();
      right.lifecycle.unmount();
      await waitFor(() =>
        expect(
          client
            .getQueryCache()
            .getAll()
            .every((query) => query.getObserversCount() === 0),
        ).toBe(true),
      );
      client.clear();
    }

    expect(mount.mock.calls).toHaveLength(priorMounts + 4);
    expect(unmount.mock.calls).toHaveLength(priorUnmounts + 4);
  });

  it("keeps appearance realtime ownership in the left slot while panels share live cache updates", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    const client = getPluginQueryClient();
    client.clear();
    let textScale = 0.9;
    const getAppearance = vi.fn(() => ({ rowHeight: 40, textScale }));
    const rpc = {
      getSidebarAppearance: getAppearance,
    } as never;
    const left = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => null,
      },
      { rpc },
    );
    const rightOne = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_panel_one", params: null },
      { rpc },
    );
    const rightTwo = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_panel_two", params: null },
      { rpc },
    );
    const appearanceKey = [
      "work-sidebar",
      "sidebar",
      "threads",
      "appearance",
    ] as const;
    const invalidate = vi.spyOn(client, "invalidateQueries");
    const appearanceInvalidations = () =>
      invalidate.mock.calls.filter(
        (call) => call[0]?.queryKey?.join("/") === appearanceKey.join("/"),
      );

    await waitFor(() => {
      expect(
        left.container
          .querySelector<HTMLElement>(".ws-list")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("0.9");
      expect(
        rightOne.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("0.9");
      expect(
        rightTwo.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("0.9");
    });
    expect(
      client
        .getQueryCache()
        .find({ queryKey: appearanceKey })
        ?.getObserversCount(),
    ).toBe(3);

    await rightOne.behavior.emitRealtime("sidebar-order:changed", {});
    await rightTwo.behavior.emitRealtime("sidebar-order:changed", {});
    expect(appearanceInvalidations()).toHaveLength(0);

    textScale = 1.05;
    await left.behavior.emitRealtime("sidebar-order:changed", {});
    await waitFor(() => {
      expect(appearanceInvalidations()).toHaveLength(1);
      expect(getAppearance).toHaveBeenCalledTimes(2);
      expect(
        rightOne.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.05");
      expect(
        rightTwo.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.05");
    });

    const saveAppearance = vi.fn(
      async ({ textScale: next }: { textScale: number }) => {
        textScale = next;
        return { rowHeight: 40, textScale: next };
      },
    );
    const settings = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          getSidebarAppearance: getAppearance,
          saveSidebarAppearance: saveAppearance,
        } as never,
      },
    );
    const input = await settings.findByRole("spinbutton", {
      name: "Text scale",
    });
    fireEvent.change(input, { target: { value: "1.1" } });
    await waitFor(() => {
      expect(saveAppearance).toHaveBeenCalledWith({ textScale: 1.1 });
      expect(
        left.container
          .querySelector<HTMLElement>(".ws-list")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.1");
      expect(
        rightOne.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.1");
      expect(
        rightTwo.container
          .querySelector<HTMLElement>(".ws-panel")
          ?.style.getPropertyValue("--ws-text-scale"),
      ).toBe("1.1");
    });

    settings.unmount();
    left.unmount();
    rightOne.unmount();
    rightTwo.unmount();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.getObserversCount() === 0),
      ).toBe(true),
    );
    invalidate.mockRestore();
    client.clear();
  });
});

describe("R6 mounted Tasks reads", () => {
  it("dedupes the shared task read across real left/right slots and cleans observers", async () => {
    const app = await loadPluginApp(() => import("../../app"));
    const client = getPluginQueryClient();
    client.clear();
    const rpc = {
      sidebarTasks: () => ({
        available: true,
        tasks: [],
        projects: [],
        error: null,
      }),
      sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
      getSidebarOrder: () => ({ threadIds: [] }),
      getThreadGroups: () => ({ groups: [] }),
      sidebarArchivedThreads: () => ({
        available: true,
        threads: [],
        error: null,
      }),
      getWorkTracker: () => ({
        visible: false,
        available: false,
        message: null,
        suggestions: [],
        items: [],
      }),
    } as never;
    const left = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => null,
      },
      { rpc },
    );
    const right = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc },
    );
    await waitFor(() =>
      expect(
        left.inspection.rpcCalls.filter(
          (call) => call.method === "sidebarTasks",
        ),
      ).toHaveLength(1),
    );
    expect(
      left.inspection.rpcCalls.filter(
        (call) => call.method === "sidebarTaskLinks",
      ),
    ).toHaveLength(1);
    expect(
      right.inspection.rpcCalls.filter(
        (call) => call.method === "sidebarTasks",
      ),
    ).toHaveLength(0);
    // Header badge and body card are separate observers but share one tracker
    // context request through the module QueryClient.
    await waitFor(() =>
      expect(
        right.inspection.rpcCalls.filter(
          (call) => call.method === "getWorkTracker",
        ),
      ).toHaveLength(1),
    );
    left.lifecycle.unmount();
    right.lifecycle.unmount();
    await waitFor(() =>
      expect(
        client
          .getQueryCache()
          .getAll()
          .every((query) => query.getObserversCount() === 0),
      ).toBe(true),
    );
    client.clear();
  });

  it("polls only task links every 30 seconds", async () => {
    vi.useFakeTimers();
    const app = await loadPluginApp(() => import("../../app"));
    const client = getPluginQueryClient();
    client.clear();
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => null,
      },
      {
        rpc: {
          sidebarTasks: () => ({
            available: true,
            tasks: [],
            projects: [],
            error: null,
          }),
          sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
          getSidebarOrder: () => ({ threadIds: [] }),
          getThreadGroups: () => ({ groups: [] }),
          sidebarArchivedThreads: () => ({
            available: true,
            threads: [],
            error: null,
          }),
        } as never,
      },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "sidebarTaskLinks",
      ),
    ).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "sidebarTaskLinks",
      ),
    ).toHaveLength(2);
    slot.lifecycle.unmount();
    client.clear();
    vi.useRealTimers();
  });
});
