// @vitest-environment jsdom
import { createElement } from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor, within } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const taskResult = { available: true, tasks: [], projects: [], error: null };
const axe = configureAxe({ runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] } });
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
  it("renders one unified Work item card instead of separate Outcome and Linear cards", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => populatedOutcome,
          getWorkTracker: () => ({
            visible: true,
            available: true,
            message: null,
            primaryKey: "LIN-1",
            suggestions: [],
            items: [
              {
                item: {
                  key: "LIN-1",
                  title: "Linked Linear work",
                  url: "https://linear.app/example/issue/LIN-1",
                  status: "Todo",
                  stateCategory: "todo",
                  priority: "high",
                  assignee: null,
                  project: null,
                },
                statusOptions: [{ id: "todo", name: "Todo", current: true }],
              },
            ],
          }),
        }),
      },
    );

    await waitFor(() => expect(slot.getByText("Linked Linear work")).toBeTruthy());
    expect(slot.queryByText("Outcome")).toBeNull();
    expect(slot.container.querySelectorAll(".ws-linear-card")).toHaveLength(0);
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("orders Work item, Tasks, Goal, Plan, then Background below Status", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      { rpc: fixture() },
    );

    await waitFor(() =>
      expect(slot.container.querySelectorAll("[data-card]")).toHaveLength(6),
    );
    const cardOrder = Array.from(
      slot.container.querySelectorAll("[data-card]"),
      (card) => card.getAttribute("data-card"),
    );
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
    expect(cardOrder).toEqual([
      "status",
      "work item",
      "tasks",
      "goal",
      "plan",
      "background",
    ]);
  });

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
    const refresh = slot.getByRole("button", { name: "Refresh work context" });
    expect(refresh.classList).toContain("ws-refresh-button");
    expect(refresh.querySelector('[data-icon="RefreshCw"]')).not.toBeNull();
    fireEvent.click(refresh);
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
    expect(slot.getByRole("heading", { name: "Needs you" })).toBeTruthy();
    const outcomeInfo = slot.container.querySelector(
      '[data-card="work item"] .ws-card-heading-info',
    );
    const priority = slot.getByRole("img", { name: "High priority" });
    expect(priority.getAttribute("data-priority")).toBe("high");
    expect(priority.querySelectorAll('[data-priority-bar="active"]')).toHaveLength(3);
    const controls = slot.getByRole("group", {
      name: "Outcome status: To do",
    });
    expect(outcomeInfo?.contains(controls)).toBe(false);
    expect(controls.querySelectorAll("button")).toHaveLength(2);
    expect(
      slot.getByRole("button", { name: "Move Ship cards back to Backlog" }),
    ).toBeTruthy();
    expect(
      slot.getByRole("button", {
        name: "Move Ship cards forward to In Progress",
      }),
    ).toBeTruthy();
    expect(
      slot.getByRole("img", { name: "Current outcome status: To do" }),
    ).toBeTruthy();
    expect(slot.container.querySelector(".ws-outcome-key")).toBeNull();
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
          updatedAt: "2026-08-29T00:00:00.000Z",
          assignee: "agent" as const,
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
    const updateTaskAssignee = vi.fn(() => ({
      taskId: "task_1",
      assignee: "agent" as const,
    }));
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
          updateTaskAssignee,
        }),
      },
    );
    try {
      await waitFor(() => expect(slot.getByText("Unrelated linked task")).toBeTruthy());
      expect(slot.queryByText(/work tasks are bound/i)).toBeNull();
      for (const title of ["Ship cards", "Run validation", "Unrelated linked task"])
        expect(slot.getAllByText(title)).toHaveLength(1);
      expect(slot.queryByRole("button", { name: "Detach WORK-1 from this thread" })).toBeNull();
      expect(slot.queryByRole("button", { name: "Detach WORK-2 from this thread" })).toBeNull();
      expect(slot.getByRole("button", { name: "Detach WORK-3 from this thread" })).toBeTruthy();
      const outcomeAssignee = slot.getByRole("button", {
        name: "Human assigned to WORK-1",
      });
      expect(
        slot.getByRole("button", { name: "Agent assigned to WORK-2" }),
      ).toBeTruthy();
      fireEvent.click(outcomeAssignee);
      fireEvent.click(
        within(
          slot.getByRole("listbox", { name: "Task assignee for WORK-1" }),
        ).getByRole("option", { name: "Agent" }),
      );
      await waitFor(() =>
        expect(updateTaskAssignee).toHaveBeenCalledWith({
          taskId: "task_1",
          assignee: "agent",
        }),
      );
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
      updatedAt: "2026-08-29T00:00:00.000Z",
      assignee: "agent" as const,
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
      updatedAt: "2026-08-29T00:00:00.000Z",
      assignee: "agent" as const,
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
          ownerThreadId: "thr_sibling",
          mode: "delegated" as const,
          idempotencyKey: "delegated",
          dispatchState: "ready" as const,
          recoveryMessage: null,
          owner: {
            threadId: "thr_sibling",
            title: "Sibling worker",
            providerId: "codex",
            liveStatus: "working" as const,
            isArchived: false,
          },
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
      expect(root.queryByText(/work tasks are bound/i)).toBeNull();
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
      expect(child.queryByText(/work tasks are bound/i)).toBeNull();
      expect(child.getByRole("button", { name: "Open Sibling worker" })).toBeTruthy();
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
      slot.getByRole("button", {
        name: "Move Ship cards forward to In Progress",
      }),
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
          name: "Move Ship cards forward to In Progress",
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
      name: "Move Ship cards forward to In Progress",
    }) as HTMLButtonElement;
    fireEvent.click(rejectedButton);
    await waitFor(() => expect(rejectedButton.disabled).toBe(false));
    rejected.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("moves the outcome status backward and forward from the below-content controls", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const updateWorkTask = vi.fn(() =>
      Promise.resolve({
        task: { ...populatedOutcome.outcome!, status: "in_review" as const },
      }),
    );
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => ({
            ...populatedOutcome,
            outcome: {
              ...populatedOutcome.outcome!,
              status: "in_progress" as const,
            },
          }),
          updateWorkTask,
        }),
      },
    );
    try {
      const previous = await slot.findByRole("button", {
        name: "Move Ship cards back to To do",
      });
      const next = slot.getByRole("button", {
        name: "Move Ship cards forward to In Review",
      });
      const controls = slot.getByRole("group", {
        name: "Outcome status: In Progress",
      });
      const current = slot.getByRole("img", {
        name: "Current outcome status: In Progress",
      });
      expect(
        slot.container
          .querySelector('[data-card="work item"] .ws-card-heading-info')
          ?.contains(controls),
      ).toBe(false);
      expect(previous.querySelector("svg")).toBeTruthy();
      expect(next.querySelector("svg")).toBeTruthy();
      expect(current.querySelector('svg[data-icon="CircleHalf"]')).toBeTruthy();
      fireEvent.click(previous);
      await waitFor(() =>
        expect(updateWorkTask).toHaveBeenCalledWith({
          taskId: "task_1",
          status: "todo",
        }),
      );
      fireEvent.click(next);
      await waitFor(() =>
        expect(updateWorkTask).toHaveBeenCalledWith({
          taskId: "task_1",
          status: "in_review",
        }),
      );
    } finally {
      slot.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
  });

  it("keeps both status directions visible and disables only the missing boundary", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_one", params: null },
      {
        rpc: fixture({
          getWorkOutcome: () => ({
            ...populatedOutcome,
            outcome: { ...populatedOutcome.outcome!, status: "done" as const },
          }),
        }),
      },
    );
    try {
      const controls = await slot.findByRole("group", {
        name: "Outcome status: Done",
      });
      expect(controls.querySelectorAll("button")).toHaveLength(2);
      expect(
        (
          slot.getByRole("button", {
            name: "Move Ship cards back to In Review",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false);
      expect(
        (
          slot.getByRole("button", {
            name: "No next outcome status for Ship cards",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    } finally {
      slot.lifecycle.unmount();
      getPluginQueryClient().clear();
    }
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

  it("projects the registered Work Tasks card into one deterministic four-section workflow", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const execution = {
      id: "task_execution",
      projectId: "project_1",
      projectName: "Work",
      key: "WORK-2",
      title: "Run the agent work",
      status: "in_progress" as const,
      priority: "high" as const,
      dueDate: null,
      parentTaskId: "task_outcome",
      updatedAt: "2026-08-29T01:00:00.000Z",
      assignee: "agent" as const,
    };
    const workflowOutcome = {
      ...outcome,
      outcome: { ...populatedOutcome.outcome!, id: "task_outcome" },
      executionTasks: [execution, { ...execution, id: "task_archived", key: "WORK-20", title: "Archived owner follow-up", status: "todo" as const, assignee: "human" as const }],
      bindings: [{
        rootThreadId: "thr_one",
        outcomeTaskId: "task_outcome",
        taskProjectId: "project_1",
        executionTaskId: "task_execution",
        ownerThreadId: "thr_owner",
        mode: "delegated" as const,
        idempotencyKey: "workflow",
        dispatchState: "ready" as const,
        recoveryMessage: null,
      }, {
        rootThreadId: "thr_one", outcomeTaskId: "task_outcome", taskProjectId: "project_1", executionTaskId: "task_archived", ownerThreadId: "thr_archived", mode: "delegated" as const, idempotencyKey: "archived", dispatchState: "ready" as const, recoveryMessage: null,
      }],
    };
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, {
      rpc: fixture({
        sidebarTasks: () => ({
          available: true,
          projects: [{ id: "project_1", name: "Work" }],
          error: null,
          tasks: [
            { ...execution, title: "Stale duplicate", linkedThreadIds: ["thr_one"], assignee: "agent" as const },
            { ...execution, id: "task_human", key: "WORK-3", title: "Approve the release", status: "in_review" as const, parentTaskId: null, linkedThreadIds: ["thr_one"], assignee: "human" as const },
            { ...execution, id: "task_next", key: "WORK-4", title: "Prepare the follow-up", status: "backlog" as const, parentTaskId: null, linkedThreadIds: ["thr_one"], assignee: "agent" as const },
            { ...execution, id: "task_done", key: "WORK-5", title: "Completed evidence", status: "done" as const, parentTaskId: null, linkedThreadIds: ["thr_one"], assignee: "agent" as const, updatedAt: "2026-08-29T00:00:10.000Z" },
            ...Array.from({ length: 6 }, (_, index) => ({ ...execution, id: `task_done_${index}`, key: `WORK-${index + 6}`, title: `Completed ${index}`, status: index === 5 ? "canceled" as const : "done" as const, parentTaskId: null, linkedThreadIds: ["thr_one"], assignee: "agent" as const, updatedAt: `2026-08-29T00:00:${20 + index}.000Z` })),
          ],
        }),
        getWorkOutcome: () => workflowOutcome,
        getWorkStatus: () => ({
          ...status,
          children: [{ id: "thr_owner", title: "Validation worker", depth: 1, status: "active" as const, runtimeStatus: "working", providerId: "codex", isArchived: false, task: null }, { id: "thr_archived", title: "Archived worker", depth: 1, status: "idle" as const, runtimeStatus: "idle", providerId: "codex", isArchived: true, task: null }],
        }),
      }),
    });
    await waitFor(() => expect(slot.getByRole("heading", { name: "Needs you" })).toBeTruthy());
    expect([...slot.container.querySelectorAll(".ws-task-workflow h3")].map((heading) => heading.textContent)).toEqual([
      "Needs you", "In progress", "Next", "Completed (7)",
    ]);
    expect(slot.getByText("Approve the release")).toBeTruthy();
    expect(slot.getByText("Archived owner follow-up").closest(".ws-task-workflow-section")?.querySelector("h3")?.textContent).toBe("Needs you");
    expect(slot.getByText("Run the agent work")).toBeTruthy();
    expect(slot.queryByText("Stale duplicate")).toBeNull();
    const openOwner = slot.getByRole("button", { name: "Open Validation worker" });
    fireEvent.click(openOwner);
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId: "thr_owner" });
    expect(slot.getByRole("img", { name: /codex provider/ })).toBeTruthy();
    expect(slot.getByText("Prepare the follow-up")).toBeTruthy();
    expect(slot.getByText("Archived owner follow-up")).toBeTruthy();
    expect(slot.getAllByText("Owner unavailable")).toHaveLength(2);
    expect(slot.queryByRole("button", { name: "Open Archived worker" })).toBeNull();
    expect(slot.getByRole("button", { name: /Completed \(7\)/ }).getAttribute("aria-expanded")).toBe("false");
    expect(slot.queryByText("Completed 5")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: /Completed \(7\)/ }));
    expect(slot.getByText("Completed 5")).toBeTruthy();
    expect(slot.getByRole("article", { name: /Canceled/ })).toBeTruthy();
    expect(slot.container.querySelectorAll(".ws-task-workflow-section:last-of-type .ws-task-workflow-row")).toHaveLength(5);
    expect(slot.getByText("Older completed tasks are available in BB Tasks.")).toBeTruthy();
    expect(slot.queryByText(/bound to this thread/i)).toBeNull();
    expect(slot.queryByRole("group", { name: "Execution tasks" })).toBeNull();
    slot.lifecycle.unmount();
    getPluginQueryClient().clear();
  });

  it("keeps workflow IDs unique and ARIA-valid across two mounted Work panels", async () => {
    getPluginQueryClient().clear();
    const app = await loadPluginApp(() => import("../../../app"));
    const first = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_one", params: null }, { rpc: fixture() });
    const second = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_two", params: null }, { rpc: fixture() });
    await waitFor(() => expect(second.getByRole("heading", { name: "Needs you" })).toBeTruthy());
    const ids = [...document.querySelectorAll(".ws-task-workflow [id]")].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect((await axe(document.body)).violations).toEqual([]);
    first.lifecycle.unmount(); second.lifecycle.unmount(); getPluginQueryClient().clear();
  });
});
