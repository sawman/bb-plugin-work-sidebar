// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient, queryKeys } from "../../../query-runtime";

type RpcHandlers = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
type TasksResult = Awaited<ReturnType<RpcHandlers["sidebarTasks"]>>;

const task = { id: "task_1", projectId: "project_1", projectName: "Work", key: "WORK-1", title: "Ship mounted fixtures", status: "todo" as const, priority: "none" as const, dueDate: null, parentTaskId: null, position: 1024, linkedThreadIds: ["thr_test"], assignee: "human" as const };
const emptyTasks: TasksResult = { available: true, tasks: [], projects: [{ id: "project_1", name: "Work" }], error: null };
const populatedTasks: TasksResult = { ...emptyTasks, tasks: [task] };
const workContext = {
  tasksAvailable: true, currentThread: { title: "Fixture thread", status: "idle" as const, runtimeStatus: "idle", providerId: "codex" },
  tasks: [], subtasks: [], outcome: null, executionTasks: [], bindings: [], legacy: { state: "none" as const, taskIds: [], message: null }, goal: null, todos: [],
  children: [], currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null,
  repository: { outcome: "not_applicable" as const, message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] },
  tracker: { visible: false, available: true, message: null, suggestions: [], item: null, statusOptions: [] },
} satisfies Awaited<ReturnType<RpcHandlers["getWorkContext"]>>;

function rpcFixtures(sidebarTasks: RpcHandlers["sidebarTasks"]): RpcHandlers {
  return {
    sidebarTasks, sidebarTaskLinks: () => ({ available: true, links: {}, error: null }), getWorkContext: () => workContext,
    getWorkChanges: () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: workContext.repository }),
    getWorkTracker: () => workContext.tracker,
    getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }),
    getWorkStatus: () => ({ currentThread: workContext.currentThread, children: [] }),
    getLatestActivity: () => ({ currentThread: { status: "idle", runtimeStatus: "idle" }, latest: null, lastUser: null, current: null }),
    getWorkOutcome: () => ({ tasksAvailable: true, outcome: null, executionTasks: [], bindings: [] }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
  } as unknown as RpcHandlers;
}

async function app() { return loadPluginApp(() => import("../../../app")); }
function leftProps() { return { activeThreadId: "thr_test", activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery: "", Original: () => null }; }

afterEach(() => { getPluginQueryClient().clear(); vi.useRealTimers(); });

describe("Tasks read slots", () => {
  it("renders the registered left Tasks tab loading, empty, populated, and accessible retry states", async () => {
    let resolve!: (value: TasksResult) => void;
    const first = new Promise<TasksResult>((done) => { resolve = done; });
    const tasks = vi.fn<RpcHandlers["sidebarTasks"]>().mockReturnValueOnce(first).mockReturnValueOnce(populatedTasks);
    const captured = await app();
    const left = renderSlot(captured.threadLists[0]!, leftProps(), { rpc: rpcFixtures(tasks) });
    fireEvent.click(left.getByRole("button", { name: "Tasks" }));
    expect(left.getByRole("status").textContent).toContain("Loading tasks…");
    resolve(emptyTasks);
    await waitFor(() => expect(left.getByText("No active tasks.")).toBeTruthy());
    fireEvent.click(left.getByRole("button", { name: "Refresh tasks" }));
    await waitFor(() => expect(left.getByText("Ship mounted fixtures")).toBeTruthy());
    left.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failing = vi.fn<RpcHandlers["sidebarTasks"]>().mockRejectedValueOnce(new Error("Tasks endpoint is down")).mockRejectedValueOnce(new Error("Tasks endpoint is down")).mockReturnValueOnce(emptyTasks);
    const retry = renderSlot(captured.threadLists[0]!, leftProps(), { rpc: rpcFixtures(failing) });
    fireEvent.click(retry.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(retry.getByRole("alert").textContent).toContain("Tasks endpoint is down"), { timeout: 2_000 });
    expect(retry.queryByText("No active tasks.")).toBeNull();
    fireEvent.click(retry.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(retry.getByText("No active tasks.")).toBeTruthy());
    expect(failing).toHaveBeenCalledTimes(3);
    retry.lifecycle.unmount();
  });

  it("renders the registered Work Tasks card loading, empty, populated, and error independently of sibling Work cards", async () => {
    let resolve!: (value: TasksResult) => void;
    const pending = new Promise<TasksResult>((done) => { resolve = done; });
    const captured = await app();
    const loading = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => pending) });
    await waitFor(() => expect(loading.getAllByRole("status").some((element) => element.textContent?.includes("Loading tasks…"))).toBe(true));
    expect(loading.getByText("Status")).toBeTruthy();
    resolve(emptyTasks);
    await waitFor(() => expect(loading.getByText("No tasks are attached to this thread.")).toBeTruthy());
    loading.lifecycle.unmount();
    getPluginQueryClient().clear();

    const populated = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => populatedTasks) });
    await waitFor(() => expect(populated.getByText("Ship mounted fixtures")).toBeTruthy());
    expect(populated.container.querySelector(".ws-thread-task-card > .ws-work-card-list > .ws-work-card-row")).toBeTruthy();
    populated.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failing = vi.fn<RpcHandlers["sidebarTasks"]>().mockRejectedValueOnce(new Error("Tasks endpoint is down")).mockRejectedValueOnce(new Error("Tasks endpoint is down")).mockReturnValueOnce(emptyTasks);
    const retry = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(failing) });
    await waitFor(() => expect(retry.getByRole("alert").textContent).toContain("Tasks endpoint is down"), { timeout: 2_000 });
    expect(retry.getByText("Status")).toBeTruthy();
    expect(retry.getByLabelText(/Codex provider status: Ready/)).toBeTruthy();
    expect(retry.queryByText("No tasks are attached to this thread.")).toBeNull();
    fireEvent.click(retry.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(retry.getByText("No tasks are attached to this thread.")).toBeTruthy());
    expect(failing).toHaveBeenCalledTimes(3);
    retry.lifecycle.unmount();
  });

  it("has one left-owned realtime invalidator across both registered slots", async () => {
    vi.useFakeTimers();
    const captured = await app();
    const tasks = vi.fn<RpcHandlers["sidebarTasks"]>().mockReturnValue(populatedTasks);
    const links = vi.fn<RpcHandlers["sidebarTaskLinks"]>()
      .mockRejectedValueOnce(new Error("Task links endpoint is down"))
      .mockReturnValue({ available: true, links: {}, error: null });
    const rpc = { ...rpcFixtures(tasks), sidebarTaskLinks: links } as RpcHandlers;
    const left = renderSlot(captured.threadLists[0]!, leftProps(), { rpc });
    const right = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc });
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(links).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(tasks).toHaveBeenCalledTimes(1);
    expect(links).toHaveBeenCalledTimes(2);
    await left.behavior.emitRealtime("work-sidebar:changed", { changed: "tasks" });
    await vi.advanceTimersByTimeAsync(1);
    expect(tasks).toHaveBeenCalledTimes(2);
    expect(links).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(links).toHaveBeenCalledTimes(4);
    expect(tasks).toHaveBeenCalledTimes(2);
    right.lifecycle.unmount();
    left.lifecycle.unmount();
    expect(getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.sidebar.tasks.list() })?.getObserversCount()).toBe(0);
    expect(getPluginQueryClient().getQueryCache().find({ queryKey: queryKeys.sidebar.tasks.links() })?.getObserversCount()).toBe(0);
  });
});
