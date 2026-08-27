// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { getPluginQueryClient, pluginInteractionStore, queryKeys, queryPolicies } from "../../query-runtime";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

describe("R2 app registration and Query lifecycle", () => {
  it("preserves every current slot registration and routes both mounted slots through one module client", async () => {
    const app = await loadPluginApp(() => import("../../app"));

    expect(app.settingsSections.map(({ id }) => id)).toEqual(["github-polling"]);
    expect(app.threadLists.map(({ id }) => id)).toEqual(["work-queue"]);
    expect(app.threadPanelActions.map(({ id }) => id)).toEqual(["work-context"]);
    expect(app.threadHeaderActions.map(({ id }) => id)).toEqual(["work-context-header"]);
    expect(app.composerCustomizations.map(({ id }) => id)).toEqual(["task-first"]);

    expect(getPluginQueryClient()).toBe(getPluginQueryClient());
    expect(queryKeys.sidebar.order()).toEqual(["work-sidebar", "sidebar", "order"]);
    expect(queryKeys.sidebar.tasks.list()).toEqual(["work-sidebar", "sidebar", "tasks", "list"]);
    expect(queryKeys.sidebar.tasks.links()).toEqual(["work-sidebar", "sidebar", "tasks", "links"]);
    expect(queryKeys.work.context("thr_test")).toEqual(["work-sidebar", "work", "context", "thr_test"]);
    expect(queryPolicies.sidebarOrderPreferences).toMatchObject({ staleTime: Infinity, gcTime: 30 * 60_000, retry: false });
    expect(queryPolicies.sidebarTasksList).toMatchObject({ staleTime: 15_000, gcTime: 10 * 60_000, retry: 1 });
    expect(queryPolicies.sidebarTaskLinks).toMatchObject({ staleTime: 15_000, gcTime: 10 * 60_000, retry: 1 });
    expect(queryPolicies.workContext).toMatchObject({ staleTime: 5_000, gcTime: 10 * 60_000, retry: 1 });
    expect(queryPolicies.workChanges).toMatchObject({ staleTime: 30_000, gcTime: 10 * 60_000, retry: false });
    expect(pluginInteractionStore.getState().selectedWorkTab).toBe("work");
    pluginInteractionStore.getState().setSelectedWorkTab("changes");
    expect(pluginInteractionStore.getState().selectedWorkTab).toBe("changes");
    pluginInteractionStore.getState().setSelectedWorkTab("work");

    // The harness mounts slots independently, matching BB's left/right slot
    // ownership. R5 turns the PR consumers into real observers on the same
    // module-generation QueryClient.
    const client = getPluginQueryClient();
    const mount = vi.spyOn(client, "mount");
    const unmount = vi.spyOn(client, "unmount");
    const left = renderSlot(app.threadLists[0]!, {
      activeThreadId: null, activeProjectId: null, isCompactViewport: false,
      onNavigate: () => undefined, searchQuery: "", Original: () => null,
    });
    const right = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_test", params: null });
    expect(mount).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll()).toHaveLength(5);
    expect(client.getQueryCache().findAll({ queryKey: ["work-sidebar", "pull-requests", "authored", "stacks"] })[0]?.getObserversCount()).toBe(1);
    expect(client.getQueryCache().findAll({ queryKey: ["work-sidebar", "pull-requests", "health"] })[0]?.getObserversCount()).toBe(2);
    left.unmount();
    right.unmount();
    expect(unmount).toHaveBeenCalledTimes(2);
    expect(client.getQueryCache().getAll().every((query) => query.getObserversCount() === 0)).toBe(true);
    client.clear();
  });
});
