// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const taskResult = { available: true, tasks: [], projects: [], error: null };
const aggregate = {
  rootThreadId: "thr_one",
  tasksAvailable: true,
  currentThread: {
    title: "Thread",
    status: "idle" as const,
    runtimeStatus: "idle",
    providerId: "codex",
  },
  tasks: [],
  subtasks: [],
  outcome: null,
  executionTasks: [],
  bindings: [],
  legacy: { state: "none" as const, taskIds: [], message: null },
  goal: null,
  todos: [],
  children: [],
  tracker: {
    visible: false,
    available: false,
    message: null,
    suggestions: [],
    items: [],
  },
};
const status = {
  rootThreadId: "thr_one",
  currentThread: aggregate.currentThread,
  children: [],
};
const outcome = {
  rootThreadId: "thr_one",
  tasksAvailable: true,
  outcome: null,
  executionTasks: [],
  bindings: [],
  legacy: { state: "none" as const, taskIds: [], message: null },
};
const populatedOutcome = {
  rootThreadId: "thr_one",
  tasksAvailable: true,
  outcome: {
    id: "task_1",
    projectId: "project_1",
    projectName: "Work",
    key: "WORK-1",
    title: "Ship cards",
    status: "todo" as const,
    priority: "high" as const,
    dueDate: "2026-08-30",
    parentTaskId: null,
    position: 1,
  },
  executionTasks: [],
  bindings: [],
  legacy: { state: "none" as const, taskIds: [], message: null },
};

function fixture(overrides: Partial<Rpc> = {}): Rpc {
  return {
    sidebarTasks: () => taskResult,
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getWorkContext: () => aggregate,
    getChanges: () => ({
      currentPullRequest: null,
      stack: null,
      stackUnavailableReason: null,
      githubStack: null,
      repository: {
        outcome: "absent",
        message: null,
        branch: null,
        base: null,
        ahead: 0,
        behind: 0,
        worktreeState: null,
        hasUncommittedChanges: false,
        changedFileCount: 0,
        changedInsertions: 0,
        changedDeletions: 0,
        changedFiles: [],
      },
    }),
    getWorkTracker: () => aggregate.tracker,
    getWorkProviderStatus: () => ({
      tone: "green",
      providerId: "codex",
      providerName: "Codex",
      statusUrl: null,
      status: "ready",
      message: null,
    }),
    getGitHubApiHealth: () => ({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    }),
    getWorkStatus: () => status,
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkOutcome: () => outcome,
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkBackgroundJobs: () => ({ items: [] }),
    ...overrides,
  } as Rpc;
}

describe("registered Work context cards", () => {
  it("isolates an Outcome RPC failure without blanking Status, Tasks, Goal, or Plan", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const failedOutcome = vi
      .fn()
      .mockRejectedValue(new Error("outcome unavailable"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      { rpc: fixture({ getWorkOutcome: failedOutcome }) },
    );
    await waitFor(
      () => expect(slot.getByText("outcome unavailable")).toBeTruthy(),
      { timeout: 3_000 },
    );
    for (const name of ["Status", "Background", "Tasks", "Goal", "Plan"])
      expect(slot.getAllByText(name).length).toBeGreaterThan(0);
    expect(slot.container.querySelectorAll("[data-card]")).toHaveLength(6);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("uses one exact typed RPC per independent card", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => status);
    const getWorkOutcome = vi.fn(() => outcome);
    const getWorkGoal = vi.fn(() => null);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const getWorkBackgroundJobs = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkStatus,
          getWorkOutcome,
          getWorkGoal,
          getWorkPlan,
          getWorkBackgroundJobs,
        }),
      },
    );
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(1));
    for (const method of [
      getWorkStatus,
      getWorkOutcome,
      getWorkGoal,
      getWorkPlan,
      getWorkBackgroundJobs,
    ])
      expect(method).toHaveBeenCalledWith({ threadId: "thr_one" });
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("invalidates every card on realtime and manual Work refresh", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => status);
    const getWorkOutcome = vi.fn(() => outcome);
    const getWorkGoal = vi.fn(() => null);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const getWorkBackgroundJobs = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkStatus,
          getWorkOutcome,
          getWorkGoal,
          getWorkPlan,
          getWorkBackgroundJobs,
        }),
      },
    );
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(slot.getByRole("img", { name: "Idle" })).toBeTruthy(),
    );
    await slot.behavior.emitRealtime("work-sidebar:changed", {
      family: "work",
      rootThreadId: "thr_one",
    });
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(2));
    fireEvent.click(slot.getByRole("button", { name: "Refresh work context" }));
    await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(3));
    for (const method of [
      getWorkStatus,
      getWorkOutcome,
      getWorkGoal,
      getWorkPlan,
      getWorkBackgroundJobs,
    ])
      expect(method).toHaveBeenCalledTimes(3);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("refreshes root, descendant, and sibling Work panels from one root-scoped signal", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const rootOutcome = vi.fn(() => outcome);
    const childOutcome = vi.fn(() => outcome);
    const siblingOutcome = vi.fn(() => outcome);
    const rootStatus = { ...status, rootThreadId: "thr_root" };
    const childStatus = { ...status, rootThreadId: "thr_root" };
    const siblingStatus = { ...status, rootThreadId: "thr_root" };
    const root = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_root", params: null },
      { rpc: fixture({ getWorkStatus: () => rootStatus, getWorkOutcome: rootOutcome }) },
    );
    const child = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_child", params: null },
      { rpc: fixture({ getWorkStatus: () => childStatus, getWorkOutcome: childOutcome }) },
    );
    const sibling = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_sibling", params: null },
      { rpc: fixture({ getWorkStatus: () => siblingStatus, getWorkOutcome: siblingOutcome }) },
    );
    try {
      await waitFor(() => expect(rootOutcome).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_root" }));
      await waitFor(() => expect(childOutcome).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_child" }));
      await waitFor(() => expect(siblingOutcome).toHaveBeenCalledExactlyOnceWith({ threadId: "thr_sibling" }));

      const rootEvent = {
        family: "work",
        rootThreadId: "thr_root",
      } as const;
      await root.behavior.emitRealtime("work-sidebar:changed", rootEvent);
      await child.behavior.emitRealtime("work-sidebar:changed", rootEvent);
      await sibling.behavior.emitRealtime("work-sidebar:changed", rootEvent);
      await waitFor(() => expect(rootOutcome).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(childOutcome).toHaveBeenCalledTimes(2));
      await waitFor(() => expect(siblingOutcome).toHaveBeenCalledTimes(2));
      expect(rootOutcome).toHaveBeenLastCalledWith({ threadId: "thr_root" });
      expect(childOutcome).toHaveBeenLastCalledWith({ threadId: "thr_child" });
      expect(siblingOutcome).toHaveBeenLastCalledWith({ threadId: "thr_sibling" });

      await root.behavior.emitRealtime("work-sidebar:changed", {
        family: "tasks",
        threadId: "thr_root",
      });
      expect(rootOutcome).toHaveBeenCalledTimes(2);
      expect(childOutcome).toHaveBeenCalledTimes(2);
      expect(siblingOutcome).toHaveBeenCalledTimes(2);
    } finally {
      root.lifecycle.unmount();
      child.lifecycle.unmount();
      sibling.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("ignores an old root signal while a panel switches threads before the new root resolves", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const statusA = { ...status, rootThreadId: "thr_root_a" };
    const statusB = {
      ...status,
      rootThreadId: "thr_root_b",
      currentThread: { ...status.currentThread, title: "Thread B" },
    };
    let resolveStatusB!: (value: typeof statusB) => void;
    const pendingStatusB = new Promise<typeof statusB>((resolve) => {
      resolveStatusB = resolve;
    });
    const getWorkStatus = vi.fn(({ threadId }: { threadId: string }) =>
      threadId === "thr_a" ? statusA : pendingStatusB,
    );
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_a", params: null },
      { rpc: fixture({ getWorkStatus, getWorkPlan }) },
    );
    try {
      await waitFor(() =>
        expect(slot.getByRole("img", { name: "Idle" })).toBeTruthy(),
      );
      slot.lifecycle.rerender(
        createElement(app.threadPanelActions[0]!.component, {
          threadId: "thr_b",
          params: null,
        }),
      );
      await waitFor(() =>
        expect(getWorkPlan).toHaveBeenCalledWith({ threadId: "thr_b" }),
      );
      const callsBeforeOldRoot = getWorkPlan.mock.calls.length;
      await slot.behavior.emitRealtime("work-sidebar:changed", {
        family: "work",
        rootThreadId: "thr_root_a",
      });
      await Promise.resolve();
      expect(getWorkPlan).toHaveBeenCalledTimes(callsBeforeOldRoot);

      resolveStatusB(statusB);
      await waitFor(() => expect(slot.getByText("Thread B")).toBeTruthy());
      await slot.behavior.emitRealtime("work-sidebar:changed", {
        family: "work",
        rootThreadId: "thr_root_b",
      });
      await waitFor(() =>
        expect(getWorkPlan).toHaveBeenCalledTimes(callsBeforeOldRoot + 1),
      );
    } finally {
      slot.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("flushes a matching root signal received while its status scope is loading", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolveStatus!: (value: typeof status) => void;
    const pendingStatus = new Promise<typeof status>((resolve) => {
      resolveStatus = resolve;
    });
    const getWorkStatus = vi.fn(() => pendingStatus);
    const getWorkPlan = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      { rpc: fixture({ getWorkStatus, getWorkPlan }) },
    );
    try {
      await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(1));
      await slot.behavior.emitRealtime("work-sidebar:changed", {
        family: "work",
        rootThreadId: "thr_one",
      });
      expect(getWorkPlan).toHaveBeenCalledTimes(1);
      resolveStatus(status);
      await waitFor(() =>
        expect(slot.getByRole("img", { name: "Idle" })).toBeTruthy(),
      );
      await waitFor(() => expect(getWorkPlan).toHaveBeenCalledTimes(2));
    } finally {
      slot.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("renders registered loading, empty, and populated cards without duplicate headings", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          sidebarTasks: () => ({
            ...taskResult,
            tasks: [
              {
                id: "task_2",
                projectId: "project_1",
                projectName: "Work",
                key: "WORK-2",
                title: "Attached task",
                status: "todo",
                priority: "none",
                dueDate: null,
                parentTaskId: null,
                position: 1,
                linkedThreadIds: ["thr_one"],
                assignee: "human",
              },
            ],
          }),
          getWorkOutcome: () => populatedOutcome,
        }),
      },
    );
    await waitFor(() => expect(slot.getByText("Attached task")).toBeTruthy());
    expect(slot.getByText("Ship cards")).toBeTruthy();
    expect(slot.container.querySelectorAll("[data-card]")).toHaveLength(6);
    expect(slot.container.querySelector(".ws-thread-task-card")).toBeTruthy();
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("keeps binding-owned tasks out of the generic attached-task presentation", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const boundOutcome = {
      ...populatedOutcome,
      executionTasks: [
        {
          id: "task_execution",
          projectId: "project_1",
          projectName: "Work",
          key: "WORK-2",
          title: "Run validation",
          status: "in_progress" as const,
          priority: "medium" as const,
          dueDate: null,
          parentTaskId: "task_1",
          position: 2,
        },
      ],
      bindings: [
        {
          rootThreadId: "thr_one",
          outcomeTaskId: "task_1",
          taskProjectId: "project_1",
          executionTaskId: null,
          ownerThreadId: null,
          mode: null,
          idempotencyKey: null,
          dispatchState: "ready" as const,
          recoveryMessage: null,
        },
        {
          rootThreadId: "thr_one",
          outcomeTaskId: "task_1",
          taskProjectId: "project_1",
          executionTaskId: "task_execution",
          ownerThreadId: "thr_one",
          mode: "direct" as const,
          idempotencyKey: "validation",
          dispatchState: "ready" as const,
          recoveryMessage: null,
        },
      ],
    };
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          sidebarTasks: () => ({
            ...taskResult,
            tasks: [
              {
                ...populatedOutcome.outcome!,
                linkedThreadIds: ["thr_one"],
                assignee: "human",
              },
              {
                ...boundOutcome.executionTasks[0]!,
                linkedThreadIds: ["thr_one"],
                assignee: "agent",
              },
              {
                id: "task_linked",
                projectId: "project_1",
                projectName: "Work",
                key: "WORK-3",
                title: "Unrelated linked task",
                status: "todo",
                priority: "none",
                dueDate: null,
                parentTaskId: null,
                position: 3,
                linkedThreadIds: ["thr_one"],
                assignee: "human",
              },
            ],
          }),
          getWorkOutcome: () => boundOutcome,
        }),
      },
    );
    try {
      await waitFor(() => expect(slot.getByText("Unrelated linked task")).toBeTruthy());
      expect(slot.container.querySelector(".ws-section-count")?.textContent).toBe("3");
      for (const title of ["Ship cards", "Run validation", "Unrelated linked task"])
        expect(slot.getAllByText(title)).toHaveLength(1);
      expect(slot.queryByRole("button", { name: "Detach WORK-1 from this thread" })).toBeNull();
      expect(slot.queryByRole("button", { name: "Detach WORK-2 from this thread" })).toBeNull();
      expect(slot.getByRole("button", { name: "Detach WORK-3 from this thread" })).toBeTruthy();
    } finally {
      slot.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("counts and offers tasks from each binding owner, not the work root", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const directExecution = {
      id: "task_direct",
      projectId: "project_1",
      projectName: "Work",
      key: "WORK-2",
      title: "Run root validation",
      status: "in_progress" as const,
      priority: "medium" as const,
      dueDate: null,
      parentTaskId: "task_1",
      position: 2,
    };
    const delegatedExecution = {
      id: "task_delegated",
      projectId: "project_1",
      projectName: "Work",
      key: "WORK-3",
      title: "Review child result",
      status: "todo" as const,
      priority: "medium" as const,
      dueDate: null,
      parentTaskId: "task_1",
      position: 3,
    };
    const ownerScopedOutcome = {
      ...populatedOutcome,
      executionTasks: [directExecution, delegatedExecution],
      bindings: [
        {
          rootThreadId: "thr_root",
          outcomeTaskId: "task_1",
          taskProjectId: "project_1",
          executionTaskId: null,
          ownerThreadId: null,
          mode: null,
          idempotencyKey: null,
          dispatchState: "ready" as const,
          recoveryMessage: null,
        },
        {
          rootThreadId: "thr_root",
          outcomeTaskId: "task_1",
          taskProjectId: "project_1",
          executionTaskId: "task_direct",
          ownerThreadId: "thr_root",
          mode: "direct" as const,
          idempotencyKey: "direct",
          dispatchState: "ready" as const,
          recoveryMessage: null,
        },
        {
          rootThreadId: "thr_root",
          outcomeTaskId: "task_1",
          taskProjectId: "project_1",
          executionTaskId: "task_delegated",
          ownerThreadId: "thr_child",
          mode: "delegated" as const,
          idempotencyKey: "delegated",
          dispatchState: "ready" as const,
          recoveryMessage: null,
        },
      ],
      legacy: { state: "none" as const, taskIds: [], message: null },
    };
    const genericRoot = {
      id: "task_generic_root",
      projectId: "project_1",
      projectName: "Work",
      key: "WORK-4",
      title: "Unbound root task",
      status: "todo" as const,
      priority: "none" as const,
      dueDate: null,
      parentTaskId: null,
      position: 4,
      linkedThreadIds: ["thr_root"],
      assignee: "human" as const,
    };
    const genericChild = {
      ...genericRoot,
      id: "task_generic_child",
      key: "WORK-5",
      title: "Unbound child task",
      position: 5,
      linkedThreadIds: ["thr_child"],
    };
    const sidebarTasks = () => ({
      ...taskResult,
      tasks: [
        { ...populatedOutcome.outcome!, linkedThreadIds: ["thr_root"], assignee: "human" as const },
        { ...directExecution, linkedThreadIds: ["thr_root"], assignee: "agent" as const },
        { ...delegatedExecution, linkedThreadIds: ["thr_child"], assignee: "agent" as const },
        genericRoot,
        genericChild,
      ],
    });
    const root = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_root", params: null },
      { rpc: fixture({ sidebarTasks, getWorkOutcome: () => ownerScopedOutcome }) },
    );
    try {
      await waitFor(() => expect(root.getByText("Unbound root task")).toBeTruthy());
      expect(root.container.querySelector(".ws-section-count")?.textContent).toBe("3");
      expect(root.getByText("2 work tasks are bound to this thread.")).toBeTruthy();
    } finally {
      root.lifecycle.unmount();
      getPluginQueryClient().clear();
    }

    const child = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_child", params: null },
      { rpc: fixture({ sidebarTasks, getWorkOutcome: () => ownerScopedOutcome }) },
    );
    try {
      await waitFor(() => expect(child.getByText("Unbound child task")).toBeTruthy());
      expect(child.container.querySelector(".ws-section-count")?.textContent).toBe("2");
      expect(child.getByText("1 work task is bound to this thread.")).toBeTruthy();
      const picker = child.getByRole("combobox", { name: "Add task to this thread" });
      fireEvent.focus(picker);
      await waitFor(() => expect(child.getByRole("option", { name: /WORK-4/ })).toBeTruthy());
      for (const key of ["WORK-1", "WORK-2", "WORK-3"])
        expect(child.queryByRole("option", { name: new RegExp(key) })).toBeNull();
    } finally {
      child.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("adopts one legacy Outcome with typed pending, error, success, and unsafe-state feedback", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const adoptedBinding = {
      rootThreadId: "thr_one",
      outcomeTaskId: "task_1",
      taskProjectId: "project_1",
      executionTaskId: null,
      ownerThreadId: null,
      mode: null,
      idempotencyKey: null,
      dispatchState: "ready" as const,
      recoveryMessage: null,
    };
    let resolveAdoption!: (value: { task: NonNullable<typeof populatedOutcome.outcome>; binding: typeof adoptedBinding }) => void;
    const pendingAdoption = new Promise<{ task: NonNullable<typeof populatedOutcome.outcome>; binding: typeof adoptedBinding }>((resolve) => {
      resolveAdoption = resolve;
    });
    const getWorkOutcome = vi
      .fn()
      .mockReturnValueOnce({
        ...outcome,
        legacy: {
          state: "adoptable" as const,
          taskIds: ["task_legacy"],
          message: "One legacy top-level attachment can be explicitly adopted.",
        },
      })
      .mockReturnValue({ ...populatedOutcome, legacy: { state: "none" as const, taskIds: [], message: null } });
    const adoptLegacyOutcome = vi.fn(() => pendingAdoption);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      { rpc: fixture({ getWorkOutcome, adoptLegacyOutcome }) },
    );
    await waitFor(() => expect(slot.getByText("One legacy top-level attachment can be explicitly adopted.")).toBeTruthy());
    const adopt = slot.getByRole("button", { name: "Adopt legacy outcome" }) as HTMLButtonElement;
    fireEvent.click(adopt);
    await waitFor(() => expect(adoptLegacyOutcome).toHaveBeenCalledWith({ rootThreadId: "thr_one", taskId: "task_legacy" }));
    expect(adopt.disabled).toBe(true);
    resolveAdoption({ task: populatedOutcome.outcome!, binding: adoptedBinding });
    await waitFor(() => expect(slot.getByText("Legacy outcome adopted.")).toBeTruthy());
    await slot.behavior.emitRealtime("work-sidebar:changed", { family: "work", rootThreadId: "thr_one" });
    await waitFor(() => expect(getWorkOutcome).toHaveBeenCalledTimes(3));
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();

    const rejected = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => ({
            ...outcome,
            legacy: {
              state: "adoptable",
              taskIds: ["task_legacy"],
              message: "One legacy top-level attachment can be explicitly adopted.",
            },
          }),
          adoptLegacyOutcome: () => Promise.reject(new Error("Adoption failed")),
        }),
      },
    );
    await waitFor(() => expect(rejected.getByRole("button", { name: "Adopt legacy outcome" })).toBeTruthy());
    fireEvent.click(rejected.getByRole("button", { name: "Adopt legacy outcome" }));
    await waitFor(() => expect(rejected.getByRole("alert").textContent).toContain("Adoption failed"));
    expect((rejected.getByRole("button", { name: "Adopt legacy outcome" }) as HTMLButtonElement).disabled).toBe(false);
    rejected.lifecycle.unmount();
    getPluginQueryClient().clear();

    const unsafe = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => ({
            ...outcome,
            legacy: {
              state: "ambiguous",
              taskIds: ["task_a", "task_b"],
              message: "Several legacy top-level tasks are attached; select one explicitly to adopt.",
            },
          }),
        }),
      },
    );
    await waitFor(() => expect(unsafe.getByText("Several legacy top-level tasks are attached; select one explicitly to adopt.")).toBeTruthy());
    expect(unsafe.queryByRole("button", { name: "Adopt legacy outcome" })).toBeNull();
    unsafe.lifecycle.unmount();
    getPluginQueryClient().clear();

    const mismatch = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => ({
            ...outcome,
            legacy: {
              state: "project_mismatch",
              taskIds: ["task_elsewhere"],
              message: "Legacy attachment is linked to a different BB project and cannot be adopted.",
            },
          }),
        }),
      },
    );
    await waitFor(() => expect(mismatch.getByText("Legacy attachment is linked to a different BB project and cannot be adopted.")).toBeTruthy());
    expect(mismatch.queryByRole("button", { name: "Adopt legacy outcome" })).toBeNull();
    mismatch.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("retries only the failed card and uses Query mutation busy/success state", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    let resolveUpdate!: (value: {
      task: NonNullable<typeof populatedOutcome.outcome>;
    }) => void;
    const pendingUpdate = new Promise<{
      task: NonNullable<typeof populatedOutcome.outcome>;
    }>((resolve) => {
      resolveUpdate = resolve;
    });
    const getWorkOutcome = vi.fn(() => populatedOutcome);
    const updateWorkTask = vi.fn(() => pendingUpdate);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      { rpc: fixture({ getWorkOutcome, updateWorkTask }) },
    );
    await waitFor(() => expect(slot.getByText("Ship cards")).toBeTruthy());
    fireEvent.click(
      slot.getByRole("button", { name: /Move Ship cards to In Progress/ }),
    );
    await waitFor(() =>
      expect(updateWorkTask).toHaveBeenCalledWith({
        taskId: "task_1",
        status: "in_progress",
      }),
    );
    expect(
      (
        slot.getByRole("button", {
          name: /Move Ship cards to In Progress/,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    resolveUpdate({ task: populatedOutcome.outcome! });
    await waitFor(() => expect(getWorkOutcome).toHaveBeenCalledTimes(2));
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();

    const rejected = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => populatedOutcome,
          updateWorkTask: () => Promise.reject(new Error("update failed")),
        }),
      },
    );
    await waitFor(() => expect(rejected.getByText("Ship cards")).toBeTruthy());
    const rejectedButton = rejected.getByRole("button", {
      name: /Move Ship cards to In Progress/,
    }) as HTMLButtonElement;
    fireEvent.click(rejectedButton);
    await waitFor(() => expect(rejectedButton.disabled).toBe(false));
    rejected.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("keeps cached A visible across A-to-B-to-A registered slot switches while revalidating", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkStatus = vi.fn(() => ({
      ...status,
      currentThread: { ...status.currentThread, status: "active" as const },
    }));
    const getLatestActivity = vi.fn(({ threadId }) => ({
      currentThread: { status: "active" as const, runtimeStatus: "active" },
      latest: { text: `activity ${threadId}`, kind: "activity" as const },
      lastUser: null,
      current: null,
    }));
    const first = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_a", params: null },
      { rpc: fixture({ getWorkStatus, getLatestActivity }) },
    );
    await waitFor(() => expect(first.getByText("activity thr_a")).toBeTruthy());
    first.lifecycle.unmount();
    const second = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_b", params: null },
      { rpc: fixture({ getWorkStatus, getLatestActivity }) },
    );
    await waitFor(() =>
      expect(second.getByText("activity thr_b")).toBeTruthy(),
    );
    second.lifecycle.unmount();
    const returned = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_a", params: null },
      { rpc: fixture({ getWorkStatus, getLatestActivity }) },
    );
    expect(returned.getByText("activity thr_a")).toBeTruthy();
    await waitFor(() =>
      expect(
        getLatestActivity.mock.calls.filter(
          ([input]) => input.threadId === "thr_a",
        ).length,
      ).toBeGreaterThanOrEqual(2),
    );
    returned.lifecycle.unmount();
    getPluginQueryClient().clear();
  });
});
