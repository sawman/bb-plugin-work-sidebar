// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys, queryPolicies } from "../../../query-runtime";
import type { TaskFactDirectory } from "../facts";

type RpcHandlers = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
type TasksResult = Awaited<ReturnType<RpcHandlers["sidebarTasks"]>>;

const task = {
  id: "task_1",
  projectId: "project_1",
  projectName: "Work",
  key: "WORK-1",
  title: "Ship mounted fixtures",
  status: "todo" as const,
  priority: "none" as const,
  dueDate: null,
  parentTaskId: null,
  updatedAt: "2026-09-04T01:00:00.000Z",
  position: 1024,
  linkedThreadIds: ["thr_test"],
  assignee: "human" as const,
};
const {
  linkedThreadIds: _linkedThreadIds,
  assignee: _assignee,
  position: _position,
  ...taskSummary
} = task;
const emptyTasks: TasksResult = {
  available: true,
  tasks: [],
  projects: [{ id: "project_1", name: "Work" }],
  error: null,
};
const populatedTasks: TasksResult = { ...emptyTasks, tasks: [task] };
const workContext = {
  rootThreadId: "thr_test",
  tasksAvailable: true,
  currentThread: {
    title: "Fixture thread",
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
} satisfies Awaited<ReturnType<RpcHandlers["getWorkContext"]>>;

function rpcFixtures(
  sidebarTasks: RpcHandlers["sidebarTasks"],
  sidebarTaskLinks: RpcHandlers["sidebarTaskLinks"] = () => ({
    available: true,
    links: {},
    error: null,
  }),
): RpcHandlers {
  return {
    sidebarTasks,
    sidebarTaskLinks,
    getWorkContext: () => workContext,
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
    getWorkTracker: () => ({
      visible: false,
      available: false,
      message: null,
      suggestions: [],
      items: [],
    }),
    getWorkProviderStatus: () => ({
      tone: "green",
      providerId: "codex",
      providerName: "Codex",
      statusUrl: null,
      status: "ready",
      message: null,
    }),
    getWorkStatus: () => ({
      rootThreadId: workContext.rootThreadId,
      currentThread: workContext.currentThread,
      children: [],
    }),
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkOutcome: () => ({
      rootThreadId: workContext.rootThreadId,
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
    }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkBackgroundJobs: () => ({ items: [] }),
    getGitHubApiHealth: () => ({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    }),
  } as unknown as RpcHandlers;
}

async function app() {
  return loadPluginApp(() => import("../../../app"));
}
function leftProps() {
  return {
    activeThreadId: "thr_test",
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: () => undefined,
    searchQuery: "",
    Original: () => null,
  };
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.useRealTimers();
});

describe("Tasks read slots", () => {
  it("refreshes list and link data once whenever the Tasks tab becomes active", async () => {
    const tasks = vi
      .fn<RpcHandlers["sidebarTasks"]>()
      .mockReturnValueOnce(emptyTasks)
      .mockReturnValue(populatedTasks);
    const links = vi.fn<RpcHandlers["sidebarTaskLinks"]>(() => ({
      available: true,
      links: {},
      error: null,
    }));
    const captured = await app();
    const left = renderSlot(captured.threadLists[0]!, leftProps(), {
      rpc: rpcFixtures(tasks, links),
    });

    await waitFor(() => expect(tasks).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(links).toHaveBeenCalledTimes(1));
    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(tasks).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(links).toHaveBeenCalledTimes(2));
    expect(left.getByText("Ship mounted fixtures")).toBeTruthy();

    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    expect(tasks).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(2);
    fireEvent.click(left.getByRole("button", { name: "Threads" }));
    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(tasks).toHaveBeenCalledTimes(3));
    await waitFor(() => expect(links).toHaveBeenCalledTimes(3));
    left.lifecycle.unmount();
  });

  it("renders the registered left Tasks tab loading, empty, populated, and accessible retry states", async () => {
    let resolve!: (value: TasksResult) => void;
    const first = new Promise<TasksResult>((done) => {
      resolve = done;
    });
    const tasks = vi
      .fn<RpcHandlers["sidebarTasks"]>()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(populatedTasks);
    const captured = await app();
    const left = renderSlot(captured.threadLists[0]!, leftProps(), {
      rpc: rpcFixtures(tasks),
    });
    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    expect(left.getByRole("status").textContent).toContain("Loading tasks…");
    resolve(emptyTasks);
    await waitFor(() =>
      expect(left.getByText("No active tasks.")).toBeTruthy(),
    );
    fireEvent.click(left.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() =>
      expect(left.getByText("Ship mounted fixtures")).toBeTruthy(),
    );
    left.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failing = vi
      .fn<RpcHandlers["sidebarTasks"]>()
      .mockRejectedValueOnce(new Error("Tasks endpoint is down"))
      .mockRejectedValueOnce(new Error("Tasks endpoint is down"))
      .mockReturnValueOnce(emptyTasks);
    const retry = renderSlot(captured.threadLists[0]!, leftProps(), {
      rpc: rpcFixtures(failing),
    });
    fireEvent.click(retry.getByRole("button", { name: "Tasks" }));
    await waitFor(
      () =>
        expect(retry.getByRole("alert").textContent).toContain(
          "Tasks endpoint is down",
        ),
      { timeout: 2_000 },
    );
    expect(retry.queryByText("No active tasks.")).toBeNull();
    fireEvent.click(retry.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(retry.getByText("No active tasks.")).toBeTruthy(),
    );
    expect(failing).toHaveBeenCalledTimes(3);
    retry.lifecycle.unmount();
  });

  it("renders the registered Work Tasks card loading, empty, populated, and error independently of sibling Work cards", async () => {
    let resolve!: (value: TasksResult) => void;
    const pending = new Promise<TasksResult>((done) => {
      resolve = done;
    });
    const captured = await app();
    const loading = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => pending) },
    );
    await waitFor(() =>
      expect(
        loading
          .getAllByRole("status")
          .some((element) => element.textContent?.includes("Loading tasks…")),
      ).toBe(true),
    );
    expect(loading.getByText("Status")).toBeTruthy();
    resolve(emptyTasks);
    await waitFor(() =>
      expect(
        loading.getByText("No tasks are attached to this thread."),
      ).toBeTruthy(),
    );
    loading.lifecycle.unmount();
    getPluginQueryClient().clear();

    const populated = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => populatedTasks) },
    );
    await waitFor(() =>
      expect(populated.getByText("Ship mounted fixtures")).toBeTruthy(),
    );
    expect(
      populated.container.querySelector(
        ".ws-thread-task-card .ws-task-workflow-row",
      ),
    ).toBeTruthy();
    populated.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failing = vi
      .fn<RpcHandlers["sidebarTasks"]>()
      .mockRejectedValueOnce(new Error("Tasks endpoint is down"))
      .mockRejectedValueOnce(new Error("Tasks endpoint is down"))
      .mockReturnValueOnce(emptyTasks);
    const retry = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(failing) },
    );
    await waitFor(
      () =>
        expect(retry.getByRole("alert").textContent).toContain(
          "Tasks endpoint is down",
        ),
      { timeout: 2_000 },
    );
    expect(retry.getByText("Status")).toBeTruthy();
    expect(retry.getByText("Work items")).toBeTruthy();
    expect(
      retry.getByRole("img", { name: /Codex provider status: Ready/ }),
    ).toBeTruthy();
    expect(
      retry.queryByText("No tasks are attached to this thread."),
    ).toBeNull();
    fireEvent.click(retry.getByRole("button", { name: "Try again" }));
    await waitFor(() =>
      expect(
        retry.getByText("No tasks are attached to this thread."),
      ).toBeTruthy(),
    );
    expect(failing).toHaveBeenCalledTimes(3);
    retry.lifecycle.unmount();
  });

  it("has one left-owned realtime invalidator across both registered slots", async () => {
    vi.useFakeTimers();
    const captured = await app();
    const tasks = vi
      .fn<RpcHandlers["sidebarTasks"]>()
      .mockReturnValue(populatedTasks);
    const links = vi
      .fn<RpcHandlers["sidebarTaskLinks"]>()
      .mockRejectedValueOnce(new Error("Task links endpoint is down"))
      .mockReturnValue({ available: true, links: {}, error: null });
    const rpc = {
      ...rpcFixtures(tasks),
      sidebarTaskLinks: links,
    } as RpcHandlers;
    const left = renderSlot(captured.threadLists[0]!, leftProps(), { rpc });
    const right = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc },
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(links).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(links).toHaveBeenCalledTimes(2);
    await left.behavior.emitRealtime("work-sidebar:changed", {
      family: "tasks",
      threadId: "thr_test",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(tasks).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(links).toHaveBeenCalledTimes(4);
    // The visible Work tab is the only Tasks-list polling owner. The left
    // sidebar still owns the one realtime subscription above.
    expect(tasks).toHaveBeenCalledTimes(3);
    right.lifecycle.unmount();
    left.lifecycle.unmount();
    expect(
      getPluginQueryClient()
        .getQueryCache()
        .find({ queryKey: queryKeys.sidebar.tasks.list(null) })
        ?.getObserversCount(),
    ).toBe(0);
    expect(
      getPluginQueryClient()
        .getQueryCache()
        .find({ queryKey: queryKeys.sidebar.tasks.links(null) })
        ?.getObserversCount(),
    ).toBe(0);
  });

  it("shares one project TaskFact directory across Tasks, Work, bindings, and Agents with bounded cleanup", async () => {
    const projectId = "project_scope";
    const tasks = vi.fn<RpcHandlers["sidebarTasks"]>(() => populatedTasks);
    const links = vi.fn<RpcHandlers["sidebarTaskLinks"]>(() => ({
      available: true,
      links: {
        thr_child: [{
          task: taskSummary,
          threadId: "thr_child",
          threadTitle: "Child worker",
          liveStatus: "working",
          role: "execution",
          mode: "delegated",
          idempotencyKey: "child-1",
          dispatchState: "ready",
        }],
      },
      error: null,
    }));
    const captured = await app();
    const rpc = {
      ...rpcFixtures(tasks, links),
      getWorkOutcome: () => ({
        rootThreadId: "thr_test",
        tasksAvailable: true,
        outcome: null,
        executionTasks: [{ ...taskSummary, assignee: "human" as const }],
        bindings: [{
          rootThreadId: "thr_test",
          outcomeTaskId: "outcome_1",
          taskProjectId: "project_1",
          executionTaskId: "task_1",
          ownerThreadId: "thr_child",
          mode: "delegated" as const,
          idempotencyKey: "child-1",
          dispatchState: "ready" as const,
          recoveryMessage: null,
        }],
        legacy: { state: "none" as const, taskIds: [], message: null },
      }),
    } as RpcHandlers;
    const left = renderSlot(captured.threadLists[0]!, {
      ...leftProps(),
      activeProjectId: projectId,
    }, {
      rpc,
      context: { projectId, threadId: "thr_test" },
    });
    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(left.getByText("Ship mounted fixtures")).toBeTruthy());

    const right = renderSlot(captured.threadPanelActions[0]!, {
      threadId: "thr_test",
      params: null,
    }, {
      rpc,
      context: { projectId, threadId: "thr_test" },
      sidebarThreads: {
        status: "ready",
        threads: [],
      },
    });
    await waitFor(() => expect(right.getByText("Ship mounted fixtures")).toBeTruthy());
    expect(tasks).toHaveBeenCalledTimes(1);

    const directory = getPluginQueryClient().getQueryData<TaskFactDirectory>(
      queryKeys.sidebar.tasks.facts(projectId),
    );
    expect(directory?.facts.task_1).toMatchObject({
      key: "WORK-1",
      title: "Ship mounted fixtures",
    });
    expect(getPluginQueryClient().getQueryData(
      queryKeys.sidebar.tasks.list(projectId),
    )).toMatchObject({
      taskIds: ["task_1"],
      relationships: [{ taskId: "task_1", linkedThreadIds: ["thr_test"] }],
    });
    const cachedOutcome = getPluginQueryClient().getQueryData<Record<string, unknown>>(
      queryKeys.work.outcome("thr_test"),
    );
    expect(cachedOutcome).toMatchObject({
      outcomeTaskId: null,
      executionTaskIds: ["task_1"],
      bindings: [{ executionTaskId: "task_1", ownerThreadId: "thr_child" }],
    });
    expect(cachedOutcome).not.toHaveProperty("outcome");
    expect(cachedOutcome).not.toHaveProperty("executionTasks");

    fireEvent.click(right.getByRole("tab", { name: "Agents" }));
    await waitFor(() => expect(links).toHaveBeenCalled());
    let cachedLinks: {
      links: Record<string, Array<Record<string, unknown>>>;
    } | undefined;
    await waitFor(() => {
      cachedLinks = getPluginQueryClient().getQueryData(
        queryKeys.sidebar.tasks.links(projectId),
      );
      expect(cachedLinks?.links.thr_child?.[0]).toMatchObject({
        taskId: "task_1",
      });
    });
    expect(cachedLinks?.links.thr_child?.[0]).toMatchObject({ taskId: "task_1" });
    expect(cachedLinks?.links.thr_child?.[0]).not.toHaveProperty("task");

    right.lifecycle.unmount();
    left.lifecycle.unmount();
    expect(queryPolicies.taskFactDirectory.gcTime).toBeGreaterThan(0);
    expect(getPluginQueryClient().getQueryCache().find({
      queryKey: queryKeys.sidebar.tasks.facts(projectId),
    })?.getObserversCount()).toBe(0);
  });
});
