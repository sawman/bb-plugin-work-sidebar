// @vitest-environment jsdom
import { act, cleanup } from "@testing-library/react";
import { focusManager, onlineManager } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
type ThreadState = "active" | "starting" | "idle";

const activity = (threadId: string, state: ThreadState = "active") => ({
  currentThread: { status: state, runtimeStatus: state },
  latest: { text: `latest ${threadId}`, kind: "assistant" as const },
  lastUser: { text: `user ${threadId}`, kind: "user" as const },
  current: null,
});

const baseStatus = (state: ThreadState = "active") => ({
  rootThreadId: "thr_root",
  currentThread: {
    title: "Thread",
    status: state,
    runtimeStatus: state,
    providerId: "codex",
  },
  children: [],
});

function fixture(overrides: Partial<Rpc> = {}): Rpc {
  return {
    sidebarTasks: () => ({
      available: true,
      tasks: [],
      projects: [],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getWorkStatus: () => baseStatus(),
    getLatestActivity: ({ threadId }: { threadId: string }) =>
      activity(threadId),
    getWorkOutcome: () => ({
      rootThreadId: "thr_root",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none" as const, taskIds: [], message: null },
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
    ...overrides,
  } as Rpc;
}

describe("registered Status activity lifecycle", () => {
  beforeEach(() => {
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    cleanup();
    getPluginQueryClient().clear();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });

  it("polls the exact latest-activity RPC every 2s only for an active selected thread and stops when idle", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => baseStatus("active"));
    let activityState: ThreadState = "active";
    const getLatestActivity = vi.fn(({ threadId }) =>
      activity(threadId, activityState),
    );
    const getWorkOutcome = vi.fn(() => ({
      rootThreadId: "thr_root",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none" as const, taskIds: [], message: null },
    }));
    const getWorkGoal = vi.fn(() => null);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_active", params: null },
      {
        rpc: fixture({
          getWorkStatus,
          getLatestActivity,
          getWorkOutcome,
          getWorkGoal,
          getWorkPlan,
        }),
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getLatestActivity).toHaveBeenCalledWith({ threadId: "thr_active" });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(2);
    expect(getWorkStatus).toHaveBeenCalledTimes(1);
    for (const method of [getWorkOutcome, getWorkGoal, getWorkPlan])
      expect(method).toHaveBeenCalledTimes(1);
    activityState = "idle";
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(3);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(3);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("uses the same 2s policy for a starting selected thread", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getLatestActivity = vi.fn(({ threadId }) =>
      activity(threadId, "starting"),
    );
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_starting", params: null },
      {
        rpc: fixture({
          getWorkStatus: () => baseStatus("starting"),
          getLatestActivity,
        }),
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(2);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("fetches idle history once without polling and leaves sibling card RPCs untouched", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => baseStatus("idle"));
    const getLatestActivity = vi.fn(({ threadId }) =>
      activity(threadId, "idle"),
    );
    const getWorkOutcome = vi.fn(() => ({
      rootThreadId: "thr_root",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none" as const, taskIds: [], message: null },
    }));
    const getWorkGoal = vi.fn(() => null);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_idle", params: null },
      {
        rpc: fixture({
          getWorkStatus,
          getLatestActivity,
          getWorkOutcome,
          getWorkGoal,
          getWorkPlan,
        }),
      },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(slot.getByText("latest thr_idle")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    for (const method of [
      getWorkStatus,
      getWorkOutcome,
      getWorkGoal,
      getWorkPlan,
    ])
      expect(method).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("does not overlap a pending poll and cleans all activity work up on unmount", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolve!: (value: ReturnType<typeof activity>) => void;
    const pending = new Promise<ReturnType<typeof activity>>((done) => {
      resolve = done;
    });
    const getLatestActivity = vi.fn(() => pending);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_pending", params: null },
      { rpc: fixture({ getLatestActivity }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
    resolve(activity("thr_pending"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    expect(
      getPluginQueryClient()
        .getQueryCache()
        .find({ queryKey: ["work-sidebar", "work", "activity", "thr_pending"] })
        ?.getObserversCount(),
    ).toBe(0);
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("isolates a late response after a selected-thread switch", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolveA!: (value: ReturnType<typeof activity>) => void;
    const delayedA = new Promise<ReturnType<typeof activity>>((done) => {
      resolveA = done;
    });
    const getLatestActivity = vi.fn(({ threadId }) =>
      threadId === "thr_a" ? delayedA : Promise.resolve(activity(threadId)),
    );
    const first = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_a", params: null },
      { rpc: fixture({ getLatestActivity }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    first.lifecycle.unmount();
    const second = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_b", params: null },
      { rpc: fixture({ getLatestActivity }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second.getByText("latest thr_b")).toBeTruthy();
    resolveA(activity("thr_a"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(second.queryByText("latest thr_a")).toBeNull();
    expect(second.getByText("latest thr_b")).toBeTruthy();
    second.lifecycle.unmount();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("dedupes a refresh collision with an in-flight activity request", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolve!: (value: ReturnType<typeof activity>) => void;
    const pending = new Promise<ReturnType<typeof activity>>((done) => {
      resolve = done;
    });
    const getLatestActivity = vi.fn(() => pending);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_collision", params: null },
      { rpc: fixture({ getLatestActivity }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    const invalidation = getPluginQueryClient().invalidateQueries({
      queryKey: ["work-sidebar", "work-context", "activity", "thr_collision"],
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    resolve(activity("thr_collision"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    await invalidation;
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    vi.useRealTimers();
  });

  it("lets Query pause background polling and resume activity on reconnect", async () => {
    vi.useFakeTimers();
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => baseStatus("active"));
    const getLatestActivity = vi.fn(({ threadId }) => activity(threadId));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_resume", params: null },
      { rpc: fixture({ getWorkStatus, getLatestActivity }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    focusManager.setFocused(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(1);
    onlineManager.setOnline(true);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(getLatestActivity).toHaveBeenCalledTimes(3);
    expect(getWorkStatus).toHaveBeenCalledTimes(2);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    focusManager.setFocused(true);
    onlineManager.setOnline(true);
    vi.useRealTimers();
  });
});
