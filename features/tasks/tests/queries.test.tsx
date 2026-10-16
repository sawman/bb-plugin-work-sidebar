// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys, queryPolicies } from "../../../query-runtime";
import type { TaskFactDirectory } from "../facts";
import { invalidateTaskQueries } from "../mutations";

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
    listHumanMessages: () => ({
      messages: [],
      cursor: null,
      activeCount: 0,
      savedCount: 0,
    }),
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
  it("isolates bounded history loading, retry, references and lifecycle from the pending list", async () => {
    const agent = { ...task, assignee: "agent" as const };
    const human = { ...task, id: "human", key: "WORK-2", title: "User decision" };
    const completed = { ...agent, id: "done", key: "WORK-3", title: "Finished work", status: "done" as const };
    const other = { ...completed, id: "other-done", key: "WORK-4", title: "Other thread history", linkedThreadIds: ["thr_other"] };
    let resolveHistory!: (response: TasksResult) => void;
    const firstHistory = new Promise<TasksResult>((resolve) => { resolveHistory = resolve; });
    let historyAttempts = 0;
    const historyFailure = { ...emptyTasks, available: false, error: "History unavailable" };
    const calls = vi.fn<RpcHandlers["sidebarTasks"]>((input) => {
      if (!input) return { ...emptyTasks, tasks: [agent, human] };
      if (input.threadId === "thr_other") return { ...emptyTasks, tasks: [other] };
      historyAttempts += 1;
      return historyAttempts === 1 ? firstHistory
        : historyAttempts === 2 ? historyFailure
          : { ...emptyTasks, tasks: [completed] };
    });
    const captured = await app();
    const slot = renderSlot(captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null }, { rpc: rpcFixtures(calls) },
    );
    await slot.findByText("Loading completed tasks…");
    await slot.findByText(agent.title);
    expect(slot.getByRole("switch", { name: "Agent assigned to WORK-1" }).hasAttribute("disabled")).toBe(false);
    const queue = slot.getByRole("heading", { name: "Queue" }).closest("section")!;
    const needsYou = slot.getByRole("heading", { name: "Needs you" }).closest("section")!;
    expect(within(queue).getByText(agent.title)).toBeTruthy();
    expect(within(needsYou).getByText(human.title)).toBeTruthy();
    resolveHistory(historyFailure);
    const retry = await slot.findByRole("button", { name: "Retry completed tasks" }, { timeout: 2_500 });
    expect(within(queue).getByText(agent.title)).toBeTruthy();
    expect(calls.mock.calls.filter(([input]) => input === null)).toHaveLength(1);
    fireEvent.click(retry);
    await slot.findByRole("button", { name: "Completed: 1 task" });
    fireEvent.click(slot.getByRole("button", { name: "Completed: 1 task" }));
    expect(slot.getByText(completed.title)).toBeTruthy();
    expect(calls.mock.calls.filter(([input]) => input === null)).toHaveLength(1);

    const client = getPluginQueryClient();
    const historyKey = queryKeys.sidebar.tasks.list(null, "thr_test");
    expect(client.getQueryData(historyKey)).toMatchObject({ taskIds: ["done"], relationships: [{ taskId: "done", linkedThreadIds: ["thr_test"] }] });
    expect(client.getQueryData(historyKey)).not.toHaveProperty("tasks");
    expect(client.getQueryData<TaskFactDirectory>(queryKeys.sidebar.tasks.facts(null))?.facts.done).toMatchObject({ assignee: "agent", status: "done" });
    expect(client.getQueryCache().find({ queryKey: historyKey, exact: true })?.gcTime).toBe(queryPolicies.sidebarTasksList.gcTime);
    const otherSlot = renderSlot(captured.threadPanelActions[0]!,
      { threadId: "thr_other", params: null },
      { rpc: rpcFixtures(calls), context: { threadId: "thr_other" } },
    );
    const otherView = within(otherSlot.container);
    await otherView.findByRole("button", { name: "Completed: 1 task" });
    fireEvent.click(otherView.getByRole("button", { name: "Completed: 1 task" }));
    expect(otherView.getByText(other.title)).toBeTruthy();
    expect(otherView.queryByText(completed.title)).toBeNull();

    const before = calls.mock.calls.length;
    await invalidateTaskQueries(client, ["list"], false, null);
    expect(calls.mock.calls.length - before).toBe(3); // Global + both scoped histories.
    vi.useFakeTimers();
    slot.lifecycle.unmount();
    otherSlot.lifecycle.unmount();
    expect(client.getQueryCache().find({ queryKey: historyKey, exact: true })?.getObserversCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(queryPolicies.sidebarTasksList.gcTime + 1);
    expect(client.getQueryData(historyKey)).toBeUndefined();
  });

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
      expect(loading.getByText("Needs you")).toBeTruthy(),
    );
    expect(loading.queryByText("No tasks are attached to this thread.")).toBeNull();
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
      { rpc: rpcFixtures((input) => input ? emptyTasks : failing(input)) },
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
      expect(retry.getByText("Needs you")).toBeTruthy(),
    );
    expect(retry.queryByText("No tasks are attached to this thread.")).toBeNull();
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
    expect(tasks).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tasks).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(2);
    await left.behavior.emitRealtime("work-sidebar:changed", {
      family: "tasks",
      threadId: "thr_test",
    });
    await vi.advanceTimersByTimeAsync(1);
    expect(tasks).toHaveBeenCalledTimes(4);
    expect(links).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(links).toHaveBeenCalledTimes(4);
    // The visible Work tab is the only Tasks-list polling owner. The left
    // sidebar still owns the one realtime subscription above.
    expect(tasks).toHaveBeenCalledTimes(6);
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
    expect(tasks.mock.calls.filter(([input]) => input === null)).toHaveLength(1);

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
