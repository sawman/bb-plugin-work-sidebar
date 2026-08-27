// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

type RpcHandlers = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
type TasksResult = Awaited<ReturnType<RpcHandlers["sidebarTasks"]>>;
type RpcCall = (method: string, input: unknown) => Promise<unknown>;

const task = { id: "task_1", projectId: "project_1", projectName: "Work", key: "WORK-1", title: "Ship mounted fixtures", status: "todo" as const, priority: "none" as const, dueDate: null, parentTaskId: null, position: 1024, linkedThreadIds: [] as string[], assignee: "human" as const };
const taskTwo = { ...task, id: "task_2", key: "WORK-2", title: "Second task", position: 2048 };
const tasks = (items = [task]): TasksResult => ({ available: true, tasks: items, projects: [{ id: "project_1", name: "Work" }], error: null });
const workContext = {
  tasksAvailable: true, currentThread: { title: "Fixture thread", status: "idle" as const, runtimeStatus: "idle", providerId: "codex" }, tasks: [], subtasks: [], outcome: null, executionTasks: [], bindings: [], legacy: { state: "none" as const, taskIds: [], message: null }, goal: null, todos: [], activity: { latest: null, lastUser: null, current: null }, children: [], currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null,
  repository: { outcome: "not_applicable" as const, message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] }, tracker: { visible: false, available: true, message: null, suggestions: [], item: null, statusOptions: [] },
} satisfies Awaited<ReturnType<RpcHandlers["getWorkContext"]>>;

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad; }); return { promise, resolve, reject }; }
function rpcFixtures(sidebarTasks: RpcHandlers["sidebarTasks"], call: RpcCall = () => Promise.resolve({})) {
  return { sidebarTasks, sidebarTaskLinks: () => ({ available: true, links: {}, error: null }), getWorkContext: () => workContext, getWorkChanges: () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: workContext.repository }), getWorkTracker: () => workContext.tracker, getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }), getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
    createSidebarTask: (input: unknown) => call("createSidebarTask", input), deleteSidebarTask: (input: unknown) => call("deleteSidebarTask", input), attachTaskToThread: (input: unknown) => call("attachTaskToThread", input), detachTaskFromThread: (input: unknown) => call("detachTaskFromThread", input), updateTaskStatus: (input: unknown) => call("updateTaskStatus", input), updateTaskAssignee: (input: unknown) => call("updateTaskAssignee", input), reorderTask: (input: unknown) => call("reorderTask", input),
  } as unknown as RpcHandlers;
}
async function app() { return loadPluginApp(() => import("../../../app")); }
function leftProps(searchQuery = "") { return { activeThreadId: "thr_test", activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery, Original: () => null }; }
async function leftSlot(items = [task], call: RpcCall = vi.fn(() => Promise.resolve({}))) { const captured = await app(); const rendered = renderSlot(captured.threadLists[0]!, leftProps(), { rpc: rpcFixtures(() => tasks(items), call) }); fireEvent.click(rendered.getByRole("button", { name: "Tasks" })); await waitFor(() => expect(rendered.getByText(items[0]!.title)).toBeTruthy()); return { rendered, call }; }

afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.restoreAllMocks(); });

describe("Tasks registered controls", () => {
  it("creates from the left slot with pending state and retains the composer after a failure", async () => {
    const pending = deferred<unknown>(); const { rendered, call } = await leftSlot([task], vi.fn((method) => method === "createSidebarTask" ? pending.promise : Promise.resolve({})));
    fireEvent.click(rendered.getByRole("button", { name: "Add task" }));
    fireEvent.change(rendered.getByPlaceholderText("Task title"), { target: { value: "A real task" } });
    fireEvent.click(rendered.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("createSidebarTask", { projectId: "project_1", title: "A real task", assignee: "human" }));
    expect((rendered.getByRole("button", { name: "Adding…" }) as HTMLButtonElement).disabled).toBe(true);
    pending.resolve({ task });
    await waitFor(() => expect(rendered.queryByPlaceholderText("Task title")).toBeNull());
    rendered.lifecycle.unmount(); getPluginQueryClient().clear();

    const failed = await leftSlot([task], vi.fn((method) => method === "createSidebarTask" ? Promise.reject(new Error("creation failed")) : Promise.resolve({})));
    fireEvent.click(failed.rendered.getByRole("button", { name: "Add task" }));
    fireEvent.change(failed.rendered.getByPlaceholderText("Task title"), { target: { value: "Keep this title" } });
    fireEvent.click(failed.rendered.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(failed.call).toHaveBeenCalledWith("createSidebarTask", { projectId: "project_1", title: "Keep this title", assignee: "human" }));
    expect(failed.rendered.getByDisplayValue("Keep this title")).toBeTruthy();
    failed.rendered.lifecycle.unmount();
  });

  it("updates status with its exact RPC and restores its usable control after an error", async () => {
    const pending = deferred<unknown>(); const { rendered, call } = await leftSlot([task], vi.fn((method) => method === "updateTaskStatus" ? pending.promise : Promise.resolve({})));
    const status = rendered.getByLabelText("Change status for WORK-1: To do") as HTMLSelectElement;
    fireEvent.change(status, { target: { value: "done" } });
    await waitFor(() => expect(call).toHaveBeenCalledWith("updateTaskStatus", { taskId: "task_1", status: "done" }));
    expect(status.disabled).toBe(true); pending.reject(new Error("status failed"));
    await waitFor(() => expect(status.disabled).toBe(false));
    rendered.lifecycle.unmount();
  });

  it("confirms deletion and preserves the task on deleted:false", async () => {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false); const cancelled = await leftSlot();
    fireEvent.contextMenu(cancelled.rendered.getByText(task.title)); fireEvent.click(cancelled.rendered.getByRole("menuitem", { name: "Delete task" }));
    expect(cancelled.call).not.toHaveBeenCalled(); cancelled.rendered.lifecycle.unmount(); getPluginQueryClient().clear();
    confirm.mockReturnValue(true);
    const rejected = await leftSlot([task], vi.fn((method) => method === "deleteSidebarTask" ? Promise.resolve({ deleted: false }) : Promise.resolve({})));
    fireEvent.contextMenu(rejected.rendered.getByText(task.title)); fireEvent.click(rejected.rendered.getByRole("menuitem", { name: "Delete task" }));
    await waitFor(() => expect(rejected.call).toHaveBeenCalledWith("deleteSidebarTask", { taskId: "task_1" }));
    expect(rejected.rendered.getByText(task.title)).toBeTruthy(); rejected.rendered.lifecycle.unmount();
    getPluginQueryClient().clear();
    const deleted = await leftSlot([task], vi.fn((method) => method === "deleteSidebarTask" ? Promise.resolve({ deleted: true }) : Promise.resolve({})));
    fireEvent.contextMenu(deleted.rendered.getByText(task.title)); fireEvent.click(deleted.rendered.getByRole("menuitem", { name: "Delete task" }));
    await waitFor(() => expect(deleted.call).toHaveBeenCalledWith("deleteSidebarTask", { taskId: "task_1" })); deleted.rendered.lifecycle.unmount();
  });

  it("attaches and detaches the active thread, but modifier selection never attaches", async () => {
    const { rendered, call } = await leftSlot(); const assign = rendered.getByRole("button", { name: task.title });
    fireEvent.click(assign, { ctrlKey: true }); expect(call).not.toHaveBeenCalled();
    fireEvent.click(assign); await waitFor(() => expect(call).toHaveBeenCalledWith("attachTaskToThread", { taskId: "task_1", threadId: "thr_test" }));
    rendered.lifecycle.unmount(); getPluginQueryClient().clear();
    const attached = await leftSlot([{ ...task, linkedThreadIds: ["thr_test"] }]); fireEvent.click(attached.rendered.getByRole("button", { name: task.title }));
    await waitFor(() => expect(attached.call).toHaveBeenCalledWith("detachTaskFromThread", { taskId: "task_1", threadId: "thr_test" })); attached.rendered.lifecycle.unmount();
  });

  it("reorders from context-menu keyboard controls with exact RPC and rollback", async () => {
    const pending = deferred<unknown>(); const { rendered, call } = await leftSlot([task, taskTwo], vi.fn((method) => method === "reorderTask" ? pending.promise : Promise.resolve({})));
    fireEvent.contextMenu(rendered.getByText(taskTwo.title)); fireEvent.click(rendered.getByRole("menuitem", { name: "Move up" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("reorderTask", { taskId: "task_2", beforeTaskId: null, afterTaskId: "task_1" }));
    pending.reject(new Error("reorder failed")); await waitFor(() => expect(rendered.getByText(task.title)).toBeTruthy());
    fireEvent.contextMenu(rendered.getByText(task.title)); fireEvent.click(rendered.getByRole("menuitem", { name: "Move down" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("reorderTask", { taskId: "task_1", beforeTaskId: "task_2", afterTaskId: null })); rendered.lifecycle.unmount();
  });

  it("operates the registered Work Tasks card searchable attach, busy detach, and optimistic assignee rollback", async () => {
    const attach = deferred<unknown>(); const call = vi.fn((method) => method === "attachTaskToThread" ? attach.promise : Promise.resolve({})); const captured = await app();
    const rendered = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => tasks([task, taskTwo]), call) });
    await waitFor(() => expect(rendered.getByLabelText("Add task to this thread")).toBeTruthy());
    const combo = rendered.getByLabelText("Add task to this thread"); fireEvent.focus(combo); fireEvent.change(combo, { target: { value: "second" } });
    fireEvent.click(rendered.getByRole("option", { name: /WORK-2/ })); fireEvent.click(rendered.getByRole("button", { name: "Add" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("attachTaskToThread", { taskId: "task_2", threadId: "thr_test" })); expect((rendered.getByRole("button", { name: "…" }) as HTMLButtonElement).disabled).toBe(true); attach.resolve({});
    await waitFor(() => expect((rendered.getByRole("button", { name: "Add" }) as HTMLButtonElement).disabled).toBe(true)); rendered.lifecycle.unmount(); getPluginQueryClient().clear();

    const successfulAssignment = deferred<unknown>(); const successfulCall = vi.fn((method) => method === "updateTaskAssignee" ? successfulAssignment.promise : Promise.resolve({})); const successful = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => tasks([{ ...task, linkedThreadIds: ["thr_test"] }]), successfulCall) });
    await waitFor(() => expect(successful.getByLabelText("Human assigned")).toBeTruthy()); fireEvent.click(successful.getByLabelText("Human assigned")); fireEvent.click(successful.getByRole("option", { name: "Agent" }));
    await waitFor(() => expect(successfulCall).toHaveBeenCalledWith("updateTaskAssignee", { taskId: "task_1", assignee: "agent" })); expect(successful.getByLabelText("Agent assigned")).toBeTruthy(); successful.lifecycle.unmount(); getPluginQueryClient().clear();
    successfulAssignment.resolve({});

    const assignment = deferred<unknown>(); const detach = deferred<unknown>(); const rightCall = vi.fn((method) => method === "updateTaskAssignee" ? assignment.promise : method === "detachTaskFromThread" ? detach.promise : Promise.resolve({}));
    const right = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => tasks([{ ...task, linkedThreadIds: ["thr_test"] }]), rightCall) });
    await waitFor(() => expect(right.getByLabelText("Human assigned")).toBeTruthy()); fireEvent.click(right.getByLabelText("Human assigned")); fireEvent.click(right.getByRole("option", { name: "Agent" }));
    await waitFor(() => expect(rightCall).toHaveBeenCalledWith("updateTaskAssignee", { taskId: "task_1", assignee: "agent" })); expect(right.getByLabelText("Agent assigned")).toBeTruthy(); assignment.reject(new Error("assignment failed"));
    await waitFor(() => expect(right.getByLabelText("Human assigned")).toBeTruthy()); const detachButton = right.getByLabelText("Detach WORK-1 from this thread") as HTMLButtonElement; fireEvent.click(detachButton); await waitFor(() => expect(rightCall).toHaveBeenCalledWith("detachTaskFromThread", { taskId: "task_1", threadId: "thr_test" })); expect(detachButton.disabled).toBe(true); detach.reject(new Error("detach failed")); await waitFor(() => expect(detachButton.disabled).toBe(false));
    expect(right.container.querySelector(".ws-thread-task-card > .ws-work-card-list")).toBeTruthy(); right.lifecycle.unmount();
  });
});
