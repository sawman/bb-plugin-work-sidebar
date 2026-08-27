// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { getPluginQueryClient, queryKeys, queryPolicies } from "../../query-runtime";
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
    expect(queryKeys.registration()).toEqual(["work-sidebar", "registration"]);
    expect(queryPolicies.registration).toMatchObject({ staleTime: 0, retry: false });

    // The harness mounts slots independently, matching BB's left/right slot
    // ownership. These registrations only provide the runtime foundation in
    // R2, so neither creates an observer, timer, or subscription yet.
    const left = renderSlot(app.threadHeaderActions[0]!, { isCompactViewport: false, threadId: "thr_test", projectId: "proj_test" });
    const right = renderSlot(app.settingsSections[0]!, {});
    expect(getPluginQueryClient().getQueryCache().getAll()).toEqual([]);
    left.unmount();
    right.unmount();
    expect(getPluginQueryClient().getQueryCache().getAll()).toEqual([]);
  });
});
