// @vitest-environment jsdom
import { createElement } from "react";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;

function fixture(getWorkBackgroundJobs: ReturnType<typeof vi.fn>): Rpc {
  return {
    sidebarTasks: () => ({
      available: true,
      tasks: [],
      projects: [],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getWorkStatus: () => ({
      rootThreadId: "thr_jobs",
      currentThread: {
        title: "Jobs thread",
        status: "idle",
        runtimeStatus: "idle",
        providerId: "codex",
      },
      children: [],
    }),
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkOutcome: () => ({
      rootThreadId: "thr_jobs",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
    }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkProviderStatus: () => ({
      tone: "green",
      providerId: "codex",
      providerName: "Codex",
      statusUrl: null,
      status: "ready",
      message: null,
    }),
    getWorkTracker: () => ({
      visible: false,
      available: false,
      message: null,
      suggestions: [],
      items: [],
    }),
    getWorkBackgroundJobs,
  } as unknown as Rpc;
}

describe("registered provider Background card", () => {
  afterEach(() => {
    cleanup();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("renders command and workflow state from one exact thread-scoped RPC", async () => {
    const getWorkBackgroundJobs = vi.fn(() => ({
      items: [
        {
          id: "watch",
          kind: "command",
          title: "Watch tests",
          detail: "vitest --watch",
          taskType: "monitor",
          status: "running",
          startedAt: 100,
          completedAt: null,
          model: "gpt-5.6-terra",
        },
        {
          id: "nightly",
          kind: "workflow",
          title: "Nightly index",
          detail: null,
          taskType: "cron",
          status: "paused",
          startedAt: 200,
          completedAt: null,
          model: "claude-opus-5[1m]",
        },
      ],
    }));
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_jobs", params: null },
      { rpc: fixture(getWorkBackgroundJobs) },
    );

    expect(await slot.findByText("Background")).toBeTruthy();
    expect(await slot.findByText("Watch tests")).toBeTruthy();
    expect(slot.getByText("Nightly index")).toBeTruthy();
    expect(slot.getByText("Running")).toBeTruthy();
    expect(slot.getByText("Paused")).toBeTruthy();
    expect(getWorkBackgroundJobs).toHaveBeenCalledExactlyOnceWith({
      threadId: "thr_jobs",
    });
    slot.lifecycle.rerender(
      createElement(app.threadPanelActions[0]!.component, {
        threadId: "thr_other",
        params: null,
      }),
    );
    await waitFor(() =>
      expect(getWorkBackgroundJobs).toHaveBeenLastCalledWith({
        threadId: "thr_other",
      }),
    );
    slot.lifecycle.unmount();
  });

  it("isolates failure from sibling cards and recovers through explicit retry", async () => {
    const getWorkBackgroundJobs = vi
      .fn()
      .mockRejectedValueOnce(new Error("background unavailable"))
      .mockRejectedValueOnce(new Error("background unavailable"))
      .mockResolvedValue({ items: [] });
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_jobs", params: null },
      { rpc: fixture(getWorkBackgroundJobs) },
    );

    expect(slot.getByText("Status")).toBeTruthy();
    expect(
      await slot.findByText("background unavailable", {}, { timeout: 3_000 }),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    expect(await slot.findByText("No provider background jobs")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("polls every five seconds while mounted and stops off the Work tab", async () => {
    vi.useFakeTimers();
    const getWorkBackgroundJobs = vi.fn().mockResolvedValue({ items: [] });
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_jobs", params: null },
      { rpc: fixture(getWorkBackgroundJobs) },
    );

    await act(async () => vi.advanceTimersByTimeAsync(0));
    expect(getWorkBackgroundJobs).toHaveBeenCalledOnce();
    await act(async () => vi.advanceTimersByTimeAsync(5_000));
    expect(getWorkBackgroundJobs).toHaveBeenCalledTimes(2);
    expect(
      getPluginQueryClient()
        .getQueryCache()
        .find({ queryKey: queryKeys.work.backgroundJobs("thr_jobs") })
        ?.getObserversCount(),
    ).toBe(1);

    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    const callsAfterLeavingWork = getWorkBackgroundJobs.mock.calls.length;
    await act(async () => vi.advanceTimersByTimeAsync(10_000));
    expect(getWorkBackgroundJobs).toHaveBeenCalledTimes(callsAfterLeavingWork);
    expect(slot.queryByText("Background")).toBeNull();
    expect(
      getPluginQueryClient()
        .getQueryCache()
        .find({ queryKey: queryKeys.work.backgroundJobs("thr_jobs") })
        ?.getObserversCount(),
    ).toBe(0);
    slot.lifecycle.unmount();
  });
});
