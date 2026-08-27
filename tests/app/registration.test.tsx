// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getMountedPluginProviderCount, getPluginQueryClient, pluginInteractionStore, queryKeys, queryPolicies } from "../../query-runtime";
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
    expect(queryKeys.work.context("thr_test")).toEqual(["work-sidebar", "work", "context", "thr_test"]);
    expect(queryKeys.github.health()).toEqual(["work-sidebar", "github", "health"]);
    expect(queryPolicies.sidebar).toMatchObject({ staleTime: 0, retry: false });
    expect(queryPolicies.work).toMatchObject({ staleTime: 30_000, retry: false });
    expect(pluginInteractionStore.getState().selectedWorkTab).toBe("work");

    // The harness mounts slots independently, matching BB's left/right slot
    // ownership. These registrations only provide the runtime foundation in
    // R2, so neither creates an observer, timer, or subscription yet.
    const left = renderSlot(app.threadLists[0]!, {
      activeThreadId: null, activeProjectId: null, isCompactViewport: false,
      onNavigate: () => undefined, searchQuery: "", Original: () => null,
    });
    const right = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_test", params: null });
    expect(getMountedPluginProviderCount()).toBe(2);
    expect(getPluginQueryClient().getQueryCache().getAll()).toEqual([]);
    left.unmount();
    right.unmount();
    expect(getMountedPluginProviderCount()).toBe(0);
    expect(getPluginQueryClient().getQueryCache().getAll()).toEqual([]);
  });
});
