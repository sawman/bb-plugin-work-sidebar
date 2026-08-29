// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import { toast } from "sonner";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";
import type { SidebarTask } from "../../../work-model";

type RpcHandlers = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
type TasksResult = Awaited<ReturnType<RpcHandlers["sidebarTasks"]>>;
type RpcCall = (method: string, input: unknown) => Promise<unknown>;

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(
  HTMLElement.prototype,
  "scrollIntoView",
);
const clipboardWrite = vi.fn(() => Promise.resolve());

const task: SidebarTask = { id: "task_1", projectId: "project_1", projectName: "Work", key: "WORK-1", title: "Ship mounted fixtures", status: "todo", priority: "none", dueDate: null, parentTaskId: null, position: 1024, linkedThreadIds: [], assignee: "human" };
const taskTwo = { ...task, id: "task_2", key: "WORK-2", title: "Second task", position: 2048 };
const tasks = (items = [task]): TasksResult => ({ available: true, tasks: items, projects: [{ id: "project_1", name: "Work" }], error: null });
const sidebarProject = { id: "project_1", name: "Work", isPersonal: false };
function sidebarThread(id: string, title: string): PluginSidebarThread {
  return {
    id,
    projectId: sidebarProject.id,
    title,
    titleFallback: null,
    parentThreadId: null,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId: "codex",
    hasPendingInteraction: false,
    activity: {
      workflows: 0,
      backgroundAgents: 0,
      backgroundCommands: 0,
      planMode: 0,
      goals: 0,
    },
    indicator: "none",
    indicatorLabel: null,
    isUnread: false,
    isPinned: false,
    isArchived: false,
    environment: null,
    host: null,
    createdAt: 0,
    updatedAt: 0,
    lastReadAt: null,
    latestAttentionAt: 0,
  } as PluginSidebarThread;
}
const sidebarThreads = [
  sidebarThread("thr_test", "Fixture thread"),
  sidebarThread("thr_two", "Second thread"),
  sidebarThread("thr_three", "Third thread"),
];
const workContext = {
  rootThreadId: "thr_test", tasksAvailable: true, currentThread: { title: "Fixture thread", status: "idle" as const, runtimeStatus: "idle", providerId: "codex" }, tasks: [], subtasks: [], outcome: null, executionTasks: [], bindings: [], legacy: { state: "none" as const, taskIds: [], message: null }, goal: null, todos: [], children: [],
} satisfies Awaited<ReturnType<RpcHandlers["getWorkContext"]>>;

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((ok, bad) => { resolve = ok; reject = bad; }); return { promise, resolve, reject }; }
function rpcFixtures(sidebarTasks: RpcHandlers["sidebarTasks"], call: RpcCall = () => Promise.resolve({}), links: Awaited<ReturnType<RpcHandlers["sidebarTaskLinks"]>>["links"] = {}) {
  return { sidebarTasks, sidebarTaskLinks: () => ({ available: true, links, error: null }), getWorkContext: () => workContext, getChanges: () => ({ currentPullRequest: null, stack: null, stackUnavailableReason: null, githubStack: null, repository: { outcome: "absent", message: null, branch: null, base: null, ahead: 0, behind: 0, worktreeState: null, hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] } }), getWorkTracker: () => ({ visible: false, available: false, message: null, suggestions: [], items: [] }), getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }), getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
    createSidebarTask: (input: unknown) => call("createSidebarTask", input), deleteSidebarTask: (input: unknown) => call("deleteSidebarTask", input), attachTaskToThread: (input: unknown) => call("attachTaskToThread", input), detachTaskFromThread: (input: unknown) => call("detachTaskFromThread", input), updateTaskStatus: (input: unknown) => call("updateTaskStatus", input), updateTaskAssignee: (input: unknown) => call("updateTaskAssignee", input), reorderTask: (input: unknown) => call("reorderTask", input),
  } as unknown as RpcHandlers;
}
async function app() { return loadPluginApp(() => import("../../../app")); }
function leftProps(searchQuery = "") { return { activeThreadId: "thr_test", activeProjectId: null, isCompactViewport: false, onNavigate: () => undefined, searchQuery, Original: () => null }; }
async function leftSlot(items = [task], call: RpcCall = vi.fn(() => Promise.resolve({})), links: Awaited<ReturnType<RpcHandlers["sidebarTaskLinks"]>>["links"] = {}) { const captured = await app(); const rendered = renderSlot(captured.threadLists[0]!, leftProps(), { sidebarThreads: { status: "ready", projects: [sidebarProject], threads: sidebarThreads }, rpc: rpcFixtures(() => tasks(items), call, links) }); fireEvent.click(rendered.getByRole("button", { name: "Tasks" })); await waitFor(() => expect(rendered.getByText(items[0]!.title)).toBeTruthy()); return { rendered, call }; }

async function expectNoAriaViolations(container: HTMLElement) {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.restoreAllMocks();
  if (scrollIntoViewDescriptor) {
    Object.defineProperty(
      HTMLElement.prototype,
      "scrollIntoView",
      scrollIntoViewDescriptor,
    );
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  }
});

beforeEach(() => {
  clipboardWrite.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

describe("Tasks registered controls", () => {
  it("keeps an open matching Combobox ARIA-valid with selected option semantics", async () => {
    const { rendered } = await leftSlot();
    fireEvent.click(rendered.getByRole("button", { name: "Add task" }));
    const project = rendered.getByRole("combobox", { name: "Task project" });
    fireEvent.focus(project);
    fireEvent.change(project, { target: { value: "Work" } });
    const option = await rendered.findByRole("option", { name: "Work" });
    expect(option.getAttribute("aria-selected")).toBe("true");
    expect(option.getAttribute("tabindex")).toBe("-1");
    expect(project.getAttribute("aria-autocomplete")).toBe("list");
    expect(project.hasAttribute("aria-activedescendant")).toBe(false);
    await expectNoAriaViolations(rendered.container);
    rendered.lifecycle.unmount();
  });

  it("dismisses a registered Combobox for pointer-down outside and focus leaving its wrapper", async () => {
    const { rendered } = await leftSlot();
    fireEvent.click(rendered.getByRole("button", { name: "Add task" }));
    const project = rendered.getByRole("combobox", { name: "Task project" });
    fireEvent.focus(project);
    await rendered.findByRole("listbox");
    fireEvent.pointerDown(document.body);
    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());

    fireEvent.focus(project);
    await rendered.findByRole("listbox");
    const outside = document.createElement("button");
    document.body.append(outside);
    fireEvent.blur(project, { relatedTarget: outside });
    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());
    outside.remove();
    rendered.lifecycle.unmount();
  });

  it("dismisses the Work existing-task picker for a click outside", async () => {
    const captured = await app();
    const rendered = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => tasks([task, taskTwo])) },
    );
    const picker = await rendered.findByRole("combobox", {
      name: "Add task to this thread",
    });

    fireEvent.focus(picker);
    const listbox = await rendered.findByRole("listbox");
    expect(listbox.closest("[data-portalled=true]")).toBeTruthy();
    fireEvent.click(document.body);

    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());
    rendered.lifecycle.unmount();
  });

  it("uses active-descendant listbox keyboard navigation in the registered Work Tasks card", async () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const captured = await app();
    const rendered = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => tasks([task, taskTwo])) },
    );
    const combo = await rendered.findByLabelText("Add task to this thread");
    combo.focus();
    const options = await rendered.findAllByRole("option");
    expect(options).toHaveLength(2);
    expect(options[0]!.id).toBeTruthy();
    expect(options[1]!.id).toBeTruthy();

    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    expect(options[0]!.getAttribute("data-active")).toBe("true");
    expect(options[0]!.getAttribute("aria-selected")).toBe("false");
    await waitFor(() =>
      expect(scrollIntoView).toHaveBeenLastCalledWith({ block: "nearest" }),
    );
    await expectNoAriaViolations(rendered.container);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    expect(options[0]!.hasAttribute("data-active")).toBe(false);
    expect(options[1]!.getAttribute("data-active")).toBe("true");
    expect(options[1]!.getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(combo, { key: "ArrowUp" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(combo, { key: "End" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(combo, { key: "Home" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(combo, { key: "Enter" });
    await waitFor(() => expect(combo.getAttribute("aria-expanded")).toBe("false"));
    expect((combo as HTMLInputElement).value).toBe("WORK-1");

    combo.focus();
    fireEvent.change(combo, { target: { value: "second" } });
    const filteredOption = await rendered.findByRole("option", {
      name: /WORK-2/,
    });
    fireEvent.keyDown(combo, { key: "End" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(filteredOption.id);
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(document.activeElement).toBe(combo);
    fireEvent.keyDown(combo, { key: "ArrowDown" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(filteredOption.id);
    fireEvent.keyDown(combo, { key: "Enter" });
    await waitFor(() => expect(combo.getAttribute("aria-expanded")).toBe("false"));
    expect((combo as HTMLInputElement).value).toBe("WORK-2");
    combo.focus();
    fireEvent.click(combo);
    await rendered.findByRole("listbox");
    fireEvent.keyDown(combo, { key: "Escape" });
    expect(combo.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(combo);
    rendered.lifecycle.unmount();
  });

  it("preserves pointer selection across both registered Combobox call sites", async () => {
    const { rendered: left } = await leftSlot();
    fireEvent.click(left.getByRole("button", { name: "Add task" }));
    const project = left.getByRole("combobox", { name: "Task project" });
    project.focus();
    const projectOption = await left.findByRole("option", { name: "Work" });
    fireEvent.mouseDown(projectOption);
    fireEvent.click(projectOption);
    expect((project as HTMLInputElement).value).toBe("Work");
    expect(left.queryByRole("listbox")).toBeNull();
    expect(document.activeElement).toBe(project);
    fireEvent.click(project);
    await left.findByRole("listbox");
    fireEvent.keyDown(project, { key: "Escape" });
    expect(left.queryByRole("combobox", { name: "Task assignee" })).toBeNull();
    left.lifecycle.unmount();
    getPluginQueryClient().clear();

    const captured = await app();
    const right = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => tasks([task, taskTwo])) },
    );
    const taskPicker = await right.findByLabelText("Add task to this thread");
    fireEvent.focus(taskPicker);
    fireEvent.click(await right.findByRole("option", { name: /WORK-2/ }));
    expect((taskPicker as HTMLInputElement).value).toBe("WORK-2");
    expect(right.queryByRole("listbox")).toBeNull();
    right.lifecycle.unmount();
  });

  it("rejects a listbox child that lacks the option role", async () => {
    const malformed = document.createElement("div");
    const listbox = document.createElement("div");
    listbox.setAttribute("role", "listbox");
    const option = document.createElement("button");
    option.textContent = "Work";
    option.setAttribute("aria-selected", "true");
    listbox.append(option);
    malformed.append(listbox);
    document.body.append(malformed);
    await expect(expectNoAriaViolations(malformed)).rejects.toThrow();
    malformed.remove();
  });

  it("keeps an open filtered Combobox ARIA-valid with an announced empty popup", async () => {
    const { rendered } = await leftSlot();
    fireEvent.click(rendered.getByRole("button", { name: "Add task" }));
    const project = rendered.getByRole("combobox", { name: "Task project" });
    fireEvent.focus(project);
    fireEvent.change(project, { target: { value: "does not match" } });
    await waitFor(() => expect(rendered.getByText("No matching options.")).toBeTruthy());
    await expectNoAriaViolations(rendered.container);
    const listbox = rendered.getByRole("listbox");
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(project.getAttribute("aria-controls")).toBe(listbox.id);
    expect(
      rendered.getByRole("option", { name: "No matching options." })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    rendered.lifecycle.unmount();
  });

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

  it("edits one searchable left-row owner thread without exposing assignment controls", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [{ ...task, priority: "high" }],
      vi.fn((method) =>
        method === "attachTaskToThread" ? pending.promise : Promise.resolve({}),
      ),
    );
    const row = rendered.getByText(task.title).closest(".ws-task-row")!;
    const trailing = row.querySelector(".ws-task-row-actions")!;
    const primaryInfo = trailing.querySelector(".ws-task-row-primary-info")!;
    expect(primaryInfo.querySelector(".ws-task-key-badge")?.textContent).toBe(
      "WORK-1",
    );
    expect(primaryInfo.querySelector(".ws-task-priority-slot")).toBeTruthy();
    expect(row.querySelector(".ws-task-meta .ws-task-key-badge")).toBeNull();
    fireEvent.click(
      rendered.getByRole("button", { name: "Copy task WORK-1" }),
    );
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith("Task WORK-1"),
    );
    expect(
      trailing.querySelector('[aria-label="Change status for WORK-1: To do"]'),
    ).toBeTruthy();
    expect(
      primaryInfo.querySelector(".ws-task-priority-slot")?.compareDocumentPosition(
        trailing.querySelector('[aria-label="Change status for WORK-1: To do"]')!,
      )! & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    expect(rendered.getByLabelText("Human assigned (read-only)")).toBeTruthy();
    expect(rendered.queryByLabelText("Human assigned")).toBeNull();
    expect(rendered.queryByLabelText("Agent assigned")).toBeNull();
    expect(
      rendered.queryByRole("button", { name: "Manage threads for WORK-1" }),
    ).toBeNull();
    const threadPicker = rendered.getByRole("button", {
      name: "Edit threads for WORK-1",
    });
    fireEvent.click(threadPicker);
    const search = rendered.getByRole("combobox", {
      name: "Search threads for WORK-1",
    });
    expect(search.getAttribute("aria-autocomplete")).toBe("list");
    const listbox = rendered.getByRole("listbox", {
      name: "Thread assignment for WORK-1",
    });
    expect(listbox.hasAttribute("aria-multiselectable")).toBe(false);
    expect(
      rendered.getByRole("option", { name: "Fixture thread" }).getAttribute(
        "aria-selected",
      ),
    ).toBe("false");
    fireEvent.change(search, { target: { value: "second" } });
    expect(
      rendered.queryByRole("option", { name: "Fixture thread" }),
    ).toBeNull();
    expect(
      rendered.getByRole("option", { name: "Second thread" }),
    ).toBeTruthy();
    await expectNoAriaViolations(rendered.container);
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(
        rendered.queryByRole("listbox", {
          name: "Thread assignment for WORK-1",
        }),
      ).toBeNull(),
    );
    fireEvent.click(threadPicker);
    fireEvent.change(
      rendered.getByRole("combobox", { name: "Search threads for WORK-1" }),
      { target: { value: "fixture" } },
    );
    fireEvent.click(rendered.getByRole("option", { name: "Fixture thread" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("attachTaskToThread", {
        taskId: "task_1",
        threadId: "thr_test",
      }),
    );
    expect((threadPicker as HTMLButtonElement).disabled).toBe(true);
    pending.resolve({ taskId: "task_1", threadId: "thr_test" });
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failedAttach = await leftSlot(
      [task],
      vi.fn((method) => method === "attachTaskToThread"
        ? Promise.reject(new Error("owner attach failed"))
        : Promise.resolve({})),
    );
    const failedTrigger = failedAttach.rendered.getByRole("button", { name: "Edit threads for WORK-1" });
    fireEvent.click(failedTrigger);
    fireEvent.click(failedAttach.rendered.getByRole("option", { name: "Fixture thread" }));
    await waitFor(() => expect(failedAttach.call).toHaveBeenCalledWith("attachTaskToThread", {
      taskId: "task_1",
      threadId: "thr_test",
    }));
    await waitFor(() => expect((failedTrigger as HTMLButtonElement).disabled).toBe(false));
    failedAttach.rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const attached = await leftSlot([
      { ...task, linkedThreadIds: ["thr_test"] },
    ]);
    const copyThread = attached.rendered.getByRole("button", {
      name: "Copy assigned thread Fixture thread",
    });
    const taskTitle = attached.rendered.getByRole("button", { name: task.title });
    fireEvent.click(copyThread);
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith("Fixture thread"),
    );
    expect(taskTitle.getAttribute("aria-pressed")).toBe("false");
    expect(attached.rendered.queryByRole("listbox")).toBeNull();
    fireEvent.click(
      attached.rendered.getByRole("button", {
        name: "Edit threads for WORK-1",
      }),
    );
    const assignedThread = attached.rendered.getByRole("option", {
      name: "Fixture thread",
    });
    expect(assignedThread.getAttribute("aria-selected")).toBe("true");
    fireEvent.click(
      attached.rendered.getByRole("option", { name: "Second thread" }),
    );
    await waitFor(() =>
      expect(attached.call).toHaveBeenCalledWith("attachTaskToThread", {
        taskId: "task_1",
        threadId: "thr_two",
      }),
    );
    await waitFor(() =>
      expect(attached.call).toHaveBeenCalledWith("detachTaskFromThread", {
        taskId: "task_1",
        threadId: "thr_test",
      }),
    );
    attached.rendered.lifecycle.unmount();
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

  it("keeps title clicks selection-only so thread links change through the explicit picker", async () => {
    const { rendered, call } = await leftSlot();
    const title = rendered.getByRole("button", { name: task.title });
    fireEvent.click(title, { ctrlKey: true });
    fireEvent.click(title, { metaKey: true });
    fireEvent.click(title);
    expect(call).not.toHaveBeenCalled();
    expect(title.getAttribute("aria-pressed")).toBe("true");
    rendered.lifecycle.unmount();
  });

  it("keeps assignee read-only except for the unowned left-row escape hatch", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [task],
      vi.fn((method) => method === "updateTaskAssignee" ? pending.promise : Promise.resolve({})),
    );
    expect(rendered.getByLabelText("Human assigned (read-only)")).toBeTruthy();
    fireEvent.contextMenu(rendered.getByText(task.title));
    fireEvent.click(rendered.getByRole("menuitem", { name: "Assign to Agent" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("updateTaskAssignee", {
      taskId: "task_1",
      assignee: "agent",
    }));
    pending.reject(new Error("assignment failed"));
    await waitFor(() => expect(rendered.getByText(task.title)).toBeTruthy());
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const owned = await leftSlot([{ ...task, linkedThreadIds: ["thr_test"] }]);
    fireEvent.contextMenu(owned.rendered.getByText(task.title));
    expect(owned.rendered.queryByRole("menuitem", { name: "Assign to Agent" })).toBeNull();
    owned.rendered.lifecycle.unmount();
  });

  it("presents unavailable owners without binding jargon", async () => {
    const bound = { ...task, linkedThreadIds: ["thr_missing"] };
    const { rendered } = await leftSlot([bound], vi.fn(() => Promise.resolve({})), {
      thr_missing: [{
        task: bound,
        threadId: "thr_missing",
        threadTitle: "Archived owner",
        liveStatus: "completed",
        role: "execution",
        mode: "delegated",
        idempotencyKey: null,
        dispatchState: null,
      }],
    });
    expect(rendered.getByText("Archived owner")).toBeTruthy();
    expect(rendered.getByText("Owner thread unavailable")).toBeTruthy();
    for (const legacy of ["Bound outcome task", "Bound delegated execution task", "Bound direct execution task"])
      expect(rendered.queryByText(legacy)).toBeNull();
    rendered.lifecycle.unmount();
  });

  it("keeps a binding-owned Queue row selectable while clearly preventing a destructive detach", async () => {
    const bound = { ...task, linkedThreadIds: ["thr_test"] };
    const { rendered, call } = await leftSlot([bound], vi.fn(() => Promise.resolve({})), {
      thr_test: [{
        task: bound,
        threadId: "thr_test",
        liveStatus: "working",
        role: "outcome",
        mode: null,
        idempotencyKey: null,
        dispatchState: null,
      }],
    });
    const row = rendered.getByRole("button", { name: bound.title });
    expect(rendered.getByText("Fixture thread")).toBeTruthy();
    expect(rendered.queryByText("Bound outcome task")).toBeNull();
    fireEvent.click(row);
    expect(call).not.toHaveBeenCalled();
    fireEvent.click(
      rendered.getByRole("button", { name: "Edit threads for WORK-1" }),
    );
    expect(
      rendered.getByRole("option", { name: "Fixture thread" }),
    ).toHaveProperty("disabled", true);
    const alternate = rendered.getByRole("option", { name: "Second thread" });
    expect(alternate).toHaveProperty("disabled", true);
    expect(
      rendered.getByText("This owner thread is managed by a durable Work binding."),
    ).toBeTruthy();
    fireEvent.click(alternate);
    expect(call).not.toHaveBeenCalled();
    rendered.lifecycle.unmount();
  });

  it("replaces and removes every legacy generic owner link in exact order", async () => {
    const linked = { ...task, linkedThreadIds: ["thr_test", "thr_two"] };
    const calls: Array<{ method: string; input: unknown }> = [];
    const { rendered } = await leftSlot([linked], vi.fn(async (method, input) => {
      calls.push({ method, input });
      return {};
    }));
    fireEvent.click(rendered.getByRole("button", { name: "Edit threads for WORK-1" }));
    fireEvent.click(rendered.getByRole("option", { name: "Third thread" }));
    await waitFor(() => expect(calls).toEqual([
      { method: "attachTaskToThread", input: { taskId: "task_1", threadId: "thr_three" } },
      { method: "detachTaskFromThread", input: { taskId: "task_1", threadId: "thr_test" } },
      { method: "detachTaskFromThread", input: { taskId: "task_1", threadId: "thr_two" } },
    ]));
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const removed: Array<{ method: string; input: unknown }> = [];
    const remove = await leftSlot([linked], vi.fn(async (method, input) => {
      removed.push({ method, input });
      return {};
    }));
    fireEvent.click(remove.rendered.getByRole("button", { name: "Edit threads for WORK-1" }));
    fireEvent.click(remove.rendered.getByRole("option", { name: "Fixture thread" }));
    await waitFor(() => expect(removed).toEqual([
      { method: "detachTaskFromThread", input: { taskId: "task_1", threadId: "thr_test" } },
      { method: "detachTaskFromThread", input: { taskId: "task_1", threadId: "thr_two" } },
    ]));
    remove.rendered.lifecycle.unmount();
  });

  it("does not detach any generic owner link when its replacement attach fails", async () => {
    const linked = { ...task, linkedThreadIds: ["thr_test", "thr_two"] };
    const { rendered, call } = await leftSlot([linked], vi.fn((method) =>
      method === "attachTaskToThread"
        ? Promise.reject(new Error("owner replacement failed"))
        : Promise.resolve({}),
    ));
    fireEvent.click(rendered.getByRole("button", { name: "Edit threads for WORK-1" }));
    fireEvent.click(rendered.getByRole("option", { name: "Third thread" }));
    await waitFor(() => expect(call).toHaveBeenCalledWith("attachTaskToThread", {
      taskId: "task_1",
      threadId: "thr_three",
    }));
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    rendered.lifecycle.unmount();
  });

  it("does not offer deletion for a durable binding owned by another thread", async () => {
    const { rendered } = await leftSlot([task], vi.fn(() => Promise.resolve({})), {
      thr_owner: [{
        task,
        threadId: "thr_owner",
        liveStatus: "working",
        role: "outcome",
        mode: null,
        idempotencyKey: null,
        dispatchState: null,
      }],
    });
    const row = rendered.getByRole("button", { name: task.title });
    expect(rendered.getByText("Owner thread unavailable")).toBeTruthy();
    expect(row.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.contextMenu(rendered.getByText(task.title));
    expect(
      rendered.getByRole("menuitem", { name: "Delete task" }),
    ).toHaveProperty("disabled", true);
    rendered.lifecycle.unmount();
  });

  it("reorders from context-menu keyboard controls with exact RPC and rollback", async () => {
    const pending = deferred<unknown>(); const { rendered, call } = await leftSlot([task, taskTwo], vi.fn((method) => method === "reorderTask" ? pending.promise : Promise.resolve({})));
    fireEvent.contextMenu(rendered.getByText(taskTwo.title)); fireEvent.keyDown(rendered.getByRole("menuitem", { name: "Move up" }), { key: "Enter" });
    await waitFor(() => expect(call).toHaveBeenCalledWith("reorderTask", { taskId: "task_2", beforeTaskId: null, afterTaskId: "task_1" }));
    pending.reject(new Error("reorder failed")); await waitFor(() => expect(rendered.getByText(task.title)).toBeTruthy());
    fireEvent.contextMenu(rendered.getByText(task.title)); fireEvent.keyDown(rendered.getByRole("menuitem", { name: "Move down" }), { key: " " });
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
    await waitFor(() => expect(successfulCall).toHaveBeenCalledWith("updateTaskAssignee", { taskId: "task_1", assignee: "agent" })); expect((successful.getByLabelText("Agent assigned") as HTMLButtonElement).disabled).toBe(true); successfulAssignment.resolve({});
    await waitFor(() => expect(successful.getByLabelText("Human assigned")).toBeTruthy()); successful.lifecycle.unmount(); getPluginQueryClient().clear();

    const assignment = deferred<unknown>(); const detach = deferred<unknown>(); const toastError = vi.spyOn(toast, "error"); const rightCall = vi.fn((method) => method === "updateTaskAssignee" ? assignment.promise : method === "detachTaskFromThread" ? detach.promise : Promise.resolve({}));
    const right = renderSlot(captured.threadPanelActions[0]!, { threadId: "thr_test", params: null }, { rpc: rpcFixtures(() => tasks([{ ...task, linkedThreadIds: ["thr_test"] }]), rightCall) });
    await waitFor(() => expect(right.getByLabelText("Human assigned")).toBeTruthy()); fireEvent.click(right.getByLabelText("Human assigned")); fireEvent.click(right.getByRole("option", { name: "Agent" }));
    await waitFor(() => expect(rightCall).toHaveBeenCalledWith("updateTaskAssignee", { taskId: "task_1", assignee: "agent" })); expect((right.getByLabelText("Agent assigned") as HTMLButtonElement).disabled).toBe(true); assignment.reject(new Error("assignment failed"));
    await waitFor(() => expect((right.getByLabelText("Human assigned") as HTMLButtonElement).disabled).toBe(false));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith("assignment failed"));
    const detachButton = right.getByLabelText("Detach WORK-1 from this thread") as HTMLButtonElement; fireEvent.click(detachButton); await waitFor(() => expect(rightCall).toHaveBeenCalledWith("detachTaskFromThread", { taskId: "task_1", threadId: "thr_test" })); expect(detachButton.disabled).toBe(true); detach.reject(new Error("detach failed")); await waitFor(() => expect(detachButton.disabled).toBe(false));
    expect(right.container.querySelector(".ws-thread-task-card .ws-task-workflow")).toBeTruthy(); right.lifecycle.unmount();
  });
});
