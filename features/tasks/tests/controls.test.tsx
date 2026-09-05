// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
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

const task: SidebarTask = {
  id: "task_1",
  projectId: "project_1",
  projectName: "Work",
  key: "WORK-1",
  title: "Ship mounted fixtures",
  status: "todo",
  priority: "none",
  dueDate: null,
  parentTaskId: null,
  position: 1024,
  linkedThreadIds: [],
  assignee: "human",
};
const taskTwo = {
  ...task,
  id: "task_2",
  key: "WORK-2",
  title: "Second task",
  position: 2048,
};
const tasks = (items = [task]): TasksResult => ({
  available: true,
  tasks: items,
  projects: [{ id: "project_1", name: "Work" }],
  error: null,
});
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}
function rpcFixtures(
  sidebarTasks: RpcHandlers["sidebarTasks"],
  call: RpcCall = () => Promise.resolve({}),
  links: Awaited<ReturnType<RpcHandlers["sidebarTaskLinks"]>>["links"] = {},
) {
  return {
    sidebarTasks,
    sidebarTaskLinks: () => ({ available: true, links, error: null }),
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
    getWorkOutcome: () => ({
      rootThreadId: "thr_test",
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
    }),
    getWorkStatus: () => ({
      rootThreadId: "thr_test",
      currentThread: workContext.currentThread,
      children: [],
    }),
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkItemQueue: () => ({
      rootThreadId: "thr_test",
      configured: false,
      queue: { current: null, backlog: [] },
    }),
    saveWorkItemQueue: (input: unknown) => call("saveWorkItemQueue", input),
    moveWorkItemToExecution: (input: unknown) =>
      call("moveWorkItemToExecution", input),
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
    createSidebarTask: (input: unknown) => call("createSidebarTask", input),
    deleteSidebarTask: (input: unknown) => call("deleteSidebarTask", input),
    attachTaskToThread: (input: unknown) => call("attachTaskToThread", input),
    detachTaskFromThread: (input: unknown) =>
      call("detachTaskFromThread", input),
    updateTaskStatus: (input: unknown) => call("updateTaskStatus", input),
    updateTaskAssignee: (input: unknown) => call("updateTaskAssignee", input),
    reorderTask: (input: unknown) => call("reorderTask", input),
  } as unknown as RpcHandlers;
}
async function app() {
  return loadPluginApp(() => import("../../../app"));
}
function leftProps(searchQuery = "") {
  return {
    activeThreadId: "thr_test",
    activeProjectId: null,
    isCompactViewport: false,
    onNavigate: () => undefined,
    searchQuery,
    Original: () => null,
  };
}
async function leftSlot(
  items = [task],
  call: RpcCall = vi.fn(() => Promise.resolve({})),
  links: Awaited<ReturnType<RpcHandlers["sidebarTaskLinks"]>>["links"] = {},
) {
  const captured = await app();
  const rendered = renderSlot(captured.threadLists[0]!, leftProps(), {
    sidebarThreads: {
      status: "ready",
      projects: [sidebarProject],
      threads: sidebarThreads,
    },
    rpc: rpcFixtures(() => tasks(items), call, links),
  });
  fireEvent.click(rendered.getByRole("button", { name: "Tasks" }));
  await waitFor(() => expect(rendered.getByText(items[0]!.title)).toBeTruthy());
  return { rendered, call };
}

async function openWorkItemPicker(
  rendered: ReturnType<typeof renderSlot>,
  destination: "goal" | "queue" = "goal",
) {
  const picker = await rendered.findByRole("combobox", {
    name: "Add a task to Goals",
  });
  if (destination === "queue") {
    fireEvent.click(
      within(await rendered.findByRole("group", { name: "Task destination" })).getByRole(
        "button",
        { name: "Queue" },
      ),
    );
    return rendered.findByRole("combobox", { name: "Add a task to Queue" });
  }
  return picker;
}

async function expectNoAriaViolations(container: HTMLElement) {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.useRealTimers();
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
  it("opens a task title in the host-owned Tasks detail view", async () => {
    const { rendered } = await leftSlot();

    fireEvent.click(
      rendered.getByRole("button", { name: "Open WORK-1 in Tasks" }),
    );

    expect(rendered.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/WORK-1" },
    });
    rendered.lifecycle.unmount();
  });

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

  it("dismisses the Work add-task picker for a click outside", async () => {
    const captured = await app();
    const rendered = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => tasks([task, taskTwo])) },
    );
    const picker = await openWorkItemPicker(rendered);

    fireEvent.focus(picker);
    const listbox = await rendered.findByRole("listbox");
    expect(listbox.closest("[data-portalled=true]")).toBeTruthy();
    fireEvent.click(document.body);

    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());
    rendered.lifecycle.unmount();
  });

  it("uses active-descendant listbox keyboard navigation in the registered Work item picker", async () => {
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
    const combo = await openWorkItemPicker(rendered);
    combo.focus();
    const options = within(await rendered.findByRole("listbox")).getAllByRole("option");
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
    expect(options[0]!.getAttribute("data-active")).not.toBe("true");
    expect(options[1]!.getAttribute("data-active")).toBe("true");
    expect(options[1]!.getAttribute("aria-selected")).toBe("false");
    fireEvent.keyDown(combo, { key: "ArrowUp" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(combo, { key: "End" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[1]!.id);
    fireEvent.keyDown(combo, { key: "Home" });
    expect(combo.getAttribute("aria-activedescendant")).toBe(options[0]!.id);
    fireEvent.keyDown(combo, { key: "Enter" });
    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());

    const filtered = await openWorkItemPicker(rendered);
    filtered.focus();
    fireEvent.change(filtered, { target: { value: "second" } });
    const filteredOption = await rendered.findByRole("option", {
      name: /WORK-2/,
    });
    fireEvent.keyDown(filtered, { key: "End" });
    expect(filtered.getAttribute("aria-activedescendant")).toBe(filteredOption.id);
    fireEvent.keyDown(filtered, { key: "Escape" });
    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());
    const reopened = await openWorkItemPicker(rendered);
    reopened.focus();
    fireEvent.click(reopened);
    await rendered.findByRole("listbox");
    fireEvent.keyDown(reopened, { key: "Escape" });
    await waitFor(() => expect(rendered.queryByRole("listbox")).toBeNull());
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
    const taskPicker = await openWorkItemPicker(right);
    fireEvent.focus(taskPicker);
    fireEvent.click(await right.findByRole("option", { name: /WORK-2/ }));
    expect(right.getByRole("combobox", { name: "Add a task to Goals" })).toBeTruthy();
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
    await waitFor(() =>
      expect(rendered.getByText("No matching options.")).toBeTruthy(),
    );
    await expectNoAriaViolations(rendered.container);
    const listbox = rendered.getByRole("listbox");
    expect(project.getAttribute("aria-expanded")).toBe("true");
    expect(project.getAttribute("aria-controls")).toBe(listbox.id);
    expect(
      rendered
        .getByRole("option", { name: "No matching options." })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    rendered.lifecycle.unmount();
  });

  it("creates from the left slot with pending state and retains the composer after a failure", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [task],
      vi.fn((method) =>
        method === "createSidebarTask" ? pending.promise : Promise.resolve({}),
      ),
    );
    fireEvent.click(rendered.getByRole("button", { name: "Add task" }));
    fireEvent.change(rendered.getByPlaceholderText("Task title"), {
      target: { value: "A real task" },
    });
    fireEvent.click(rendered.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("createSidebarTask", {
        projectId: "project_1",
        title: "A real task",
        assignee: "human",
      }),
    );
    expect(
      (rendered.getByRole("button", { name: "Adding…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    pending.resolve({ task });
    await waitFor(() =>
      expect(rendered.queryByPlaceholderText("Task title")).toBeNull(),
    );
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const failed = await leftSlot(
      [task],
      vi.fn((method) =>
        method === "createSidebarTask"
          ? Promise.reject(new Error("creation failed"))
          : Promise.resolve({}),
      ),
    );
    fireEvent.click(failed.rendered.getByRole("button", { name: "Add task" }));
    fireEvent.change(failed.rendered.getByPlaceholderText("Task title"), {
      target: { value: "Keep this title" },
    });
    fireEvent.click(failed.rendered.getByRole("button", { name: "Add" }));
    await waitFor(() =>
      expect(failed.call).toHaveBeenCalledWith("createSidebarTask", {
        projectId: "project_1",
        title: "Keep this title",
        assignee: "human",
      }),
    );
    expect(failed.rendered.getByDisplayValue("Keep this title")).toBeTruthy();
    failed.rendered.lifecycle.unmount();
  });

  it("updates status with its exact RPC and restores its usable control after an error", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [task],
      vi.fn((method) =>
        method === "updateTaskStatus" ? pending.promise : Promise.resolve({}),
      ),
    );
    const status = rendered.getByRole("button", {
      name: "Change status for WORK-1: To do",
    }) as HTMLButtonElement;
    fireEvent.click(status);
    fireEvent.click(rendered.getByRole("option", { name: "Done" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("updateTaskStatus", {
        taskId: "task_1",
        status: "done",
      }),
    );
    expect(status.disabled).toBe(true);
    pending.reject(new Error("status failed"));
    await waitFor(() => expect(status.disabled).toBe(false));
    rendered.lifecycle.unmount();
  });

  it("edits one searchable goal-row owner thread without an assignment switch", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [{ ...task, priority: "high" }],
      vi.fn((method) =>
        method === "attachTaskToThread" ? pending.promise : Promise.resolve({}),
      ),
    );
    const row = rendered.getByText(task.title).closest(".ws-task-row")!;
    const trailing = row.querySelector(".ws-task-row-actions")!;
    const metadata = row.querySelector(".ws-task-meta")!;
    expect(metadata.querySelector(".ws-task-key-inline")?.textContent).toBe(
      "WORK-1",
    );
    const primaryInfo = metadata.querySelector(".ws-task-row-primary-info")!;
    expect(primaryInfo.querySelector(".ws-task-key-inline")).toBeTruthy();
    expect(primaryInfo.querySelector(".ws-task-priority-slot")).toBeTruthy();
    expect(metadata.querySelector(".ws-task-thread-picker")).toBeTruthy();
    expect(
      primaryInfo.nextElementSibling?.classList.contains(
        "ws-task-thread-picker",
      ),
    ).toBe(true);
    fireEvent.click(rendered.getByRole("button", { name: "Copy task WORK-1" }));
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith("Task WORK-1"),
    );
    expect(
      trailing.querySelector('[aria-label="Change status for WORK-1: To do"]'),
    ).toBeTruthy();
    expect(
      rendered.queryByRole("switch", { name: "Human assigned to WORK-1" }),
    ).toBeNull();
    expect(trailing.querySelector('[role="switch"]')).toBeNull();
    expect(
      rendered.queryByRole("button", { name: "Manage threads for WORK-1" }),
    ).toBeNull();
    const threadPicker = rendered.getByRole("button", {
      name: "Edit threads for WORK-1",
    });
    expect(threadPicker.parentElement?.classList).toContain("ws-action-tooltip");
    expect(threadPicker.parentElement?.parentElement?.classList).toContain(
      "ws-task-thread-chip",
    );
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
      rendered
        .getByRole("option", { name: "Fixture thread" })
        .getAttribute("aria-selected"),
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
      vi.fn((method) =>
        method === "attachTaskToThread"
          ? Promise.reject(new Error("owner attach failed"))
          : Promise.resolve({}),
      ),
    );
    const failedTrigger = failedAttach.rendered.getByRole("button", {
      name: "Edit threads for WORK-1",
    });
    fireEvent.click(failedTrigger);
    fireEvent.click(
      failedAttach.rendered.getByRole("option", { name: "Fixture thread" }),
    );
    await waitFor(() =>
      expect(failedAttach.call).toHaveBeenCalledWith("attachTaskToThread", {
        taskId: "task_1",
        threadId: "thr_test",
      }),
    );
    await waitFor(() =>
      expect((failedTrigger as HTMLButtonElement).disabled).toBe(false),
    );
    failedAttach.rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const attached = await leftSlot([
      { ...task, linkedThreadIds: ["thr_test"] },
    ]);
    const copyThread = attached.rendered.getByRole("button", {
      name: "Copy assigned thread Fixture thread",
    });
    const taskTitle = attached.rendered.getByRole("button", {
      name: "Open WORK-1 in Tasks",
    });
    fireEvent.click(copyThread);
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith("Fixture thread"),
    );
    expect(taskTitle.getAttribute("aria-pressed")).toBeNull();
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
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false);
    const cancelled = await leftSlot();
    fireEvent.contextMenu(cancelled.rendered.getByText(task.title));
    fireEvent.click(
      cancelled.rendered.getByRole("menuitem", { name: "Delete task" }),
    );
    expect(cancelled.call).not.toHaveBeenCalled();
    cancelled.rendered.lifecycle.unmount();
    getPluginQueryClient().clear();
    confirm.mockReturnValue(true);
    const rejected = await leftSlot(
      [task],
      vi.fn((method) =>
        method === "deleteSidebarTask"
          ? Promise.resolve({ deleted: false })
          : Promise.resolve({}),
      ),
    );
    fireEvent.contextMenu(rejected.rendered.getByText(task.title));
    fireEvent.click(
      rejected.rendered.getByRole("menuitem", { name: "Delete task" }),
    );
    await waitFor(() =>
      expect(rejected.call).toHaveBeenCalledWith("deleteSidebarTask", {
        taskId: "task_1",
      }),
    );
    expect(rejected.rendered.getByText(task.title)).toBeTruthy();
    rejected.rendered.lifecycle.unmount();
    getPluginQueryClient().clear();
    const deleted = await leftSlot(
      [task],
      vi.fn((method) =>
        method === "deleteSidebarTask"
          ? Promise.resolve({ deleted: true })
          : Promise.resolve({}),
      ),
    );
    fireEvent.contextMenu(deleted.rendered.getByText(task.title));
    fireEvent.click(
      deleted.rendered.getByRole("menuitem", { name: "Delete task" }),
    );
    await waitFor(() =>
      expect(deleted.call).toHaveBeenCalledWith("deleteSidebarTask", {
        taskId: "task_1",
      }),
    );
    deleted.rendered.lifecycle.unmount();
  });

  it("keeps modified title clicks selectable while a primary click opens Tasks", async () => {
    const { rendered, call } = await leftSlot();
    const title = rendered.getByRole("button", { name: "Open WORK-1 in Tasks" });
    fireEvent.click(title, { ctrlKey: true });
    fireEvent.click(title, { metaKey: true });
    fireEvent.click(title);
    expect(call).not.toHaveBeenCalled();
    expect(rendered.inspection.navigateCalls).toContainEqual({
      method: "toPluginPanel",
      path: "tasks",
      options: { subPath: "task/WORK-1" },
    });
    rendered.lifecycle.unmount();
  });

  it("uses the shared delayed assignment switch only for Queue rows", async () => {
    const child = {
      ...task,
      id: "task_child",
      key: "WORK-2",
      title: "Nested execution task",
      parentTaskId: task.id,
      position: 2048,
    };
    const { rendered, call } = await leftSlot(
      [task, child],
      vi.fn(() => Promise.resolve({})),
    );
    expect(
      rendered.queryByRole("switch", { name: "Human assigned to WORK-1" }),
    ).toBeNull();
    fireEvent.click(rendered.getByRole("button", {
      name: "Expand subtasks for WORK-1",
    }));
    const control = rendered.getByRole("switch", {
      name: "Human assigned to WORK-2",
    });
    fireEvent.keyDown(control, { key: "ArrowRight" });
    await waitFor(
      () => expect(call).toHaveBeenCalledWith("updateTaskAssignee", {
        taskId: "task_child",
        assignee: "agent",
      }),
      { timeout: 2_500 },
    );
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const owned = await leftSlot([
      { ...task, linkedThreadIds: ["thr_test"] },
      { ...child, linkedThreadIds: ["thr_test"] },
    ]);
    fireEvent.click(owned.rendered.getByRole("button", {
      name: "Expand subtasks for WORK-1",
    }));
    expect(
      owned.rendered.getByRole("switch", { name: "Human assigned to WORK-2" }),
    ).toBeTruthy();
    owned.rendered.lifecycle.unmount();
  });

  it("starts left-row subtasks collapsed in a fixed hierarchy gutter", async () => {
    const child = {
      ...task,
      id: "task_child",
      key: "WORK-2",
      title: "Nested execution task",
      parentTaskId: task.id,
      position: 2048,
    };
    const { rendered } = await leftSlot([task, child]);
    const disclosure = rendered.getByRole("button", {
      name: "Expand subtasks for WORK-1",
    });
    expect(disclosure.getAttribute("aria-describedby")).toBeNull();
    const children = rendered.container.querySelector<HTMLElement>(
      "#ws-task-children-task_1",
    );
    expect(children).not.toBeNull();
    expect(children!.hidden).toBe(true);
    const parentRow = rendered.getByText(task.title).closest(".ws-task-row")!;
    const childRow = rendered.getByText(child.title).closest(".ws-task-row")!;
    expect(parentRow.querySelector(":scope > .ws-task-hierarchy-slot")).toBeTruthy();
    expect(childRow.querySelector(":scope > .ws-task-hierarchy-slot")).toBeTruthy();
    expect(childRow.parentElement?.classList).toContain("ws-task-children");
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(children!.hidden).toBe(false);
    expect(rendered.getByText(task.title)).toBeTruthy();
    expect(
      rendered.getByRole("button", { name: "Collapse subtasks for WORK-1" }),
    ).toBe(disclosure);
    fireEvent.click(disclosure);
    expect(children!.hidden).toBe(true);
    await expectNoAriaViolations(rendered.container);
    rendered.lifecycle.unmount();
  });

  it("presents unavailable owners without binding jargon", async () => {
    const bound = { ...task, linkedThreadIds: ["thr_missing"] };
    const { rendered } = await leftSlot(
      [bound],
      vi.fn(() => Promise.resolve({})),
      {
        thr_missing: [
          {
            task: bound,
            threadId: "thr_missing",
            threadTitle: "Archived owner",
            liveStatus: "completed",
            role: "execution",
            mode: "delegated",
            idempotencyKey: null,
            dispatchState: null,
          },
        ],
      },
    );
    expect(rendered.getByText("Archived owner")).toBeTruthy();
    expect(rendered.getByText("Owner thread unavailable")).toBeTruthy();
    for (const legacy of [
      "Bound outcome task",
      "Bound delegated execution task",
      "Bound direct execution task",
    ])
      expect(rendered.queryByText(legacy)).toBeNull();
    rendered.lifecycle.unmount();
  });

  it("keeps a binding-owned Queue row selectable while clearly preventing a destructive detach", async () => {
    const bound = { ...task, linkedThreadIds: ["thr_test"] };
    const { rendered, call } = await leftSlot(
      [bound],
      vi.fn(() => Promise.resolve({})),
      {
        thr_test: [
          {
            task: bound,
            threadId: "thr_test",
            liveStatus: "working",
            role: "outcome",
            mode: null,
            idempotencyKey: null,
            dispatchState: null,
          },
        ],
      },
    );
    const row = rendered.getByRole("button", { name: "Open WORK-1 in Tasks" });
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
      rendered.getByText(
        "This owner thread is managed by a durable Work binding.",
      ),
    ).toBeTruthy();
    fireEvent.click(alternate);
    expect(call).not.toHaveBeenCalled();
    rendered.lifecycle.unmount();
  });

  it("replaces and removes every legacy generic owner link in exact order", async () => {
    const linked = { ...task, linkedThreadIds: ["thr_test", "thr_two"] };
    const calls: Array<{ method: string; input: unknown }> = [];
    const { rendered } = await leftSlot(
      [linked],
      vi.fn(async (method, input) => {
        calls.push({ method, input });
        return {};
      }),
    );
    fireEvent.click(
      rendered.getByRole("button", { name: "Edit threads for WORK-1" }),
    );
    fireEvent.click(rendered.getByRole("option", { name: "Third thread" }));
    await waitFor(() =>
      expect(calls).toEqual([
        {
          method: "attachTaskToThread",
          input: { taskId: "task_1", threadId: "thr_three" },
        },
        {
          method: "detachTaskFromThread",
          input: { taskId: "task_1", threadId: "thr_test" },
        },
        {
          method: "detachTaskFromThread",
          input: { taskId: "task_1", threadId: "thr_two" },
        },
      ]),
    );
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const removed: Array<{ method: string; input: unknown }> = [];
    const remove = await leftSlot(
      [linked],
      vi.fn(async (method, input) => {
        removed.push({ method, input });
        return {};
      }),
    );
    fireEvent.click(
      remove.rendered.getByRole("button", { name: "Edit threads for WORK-1" }),
    );
    fireEvent.click(
      remove.rendered.getByRole("option", { name: "Fixture thread" }),
    );
    await waitFor(() =>
      expect(removed).toEqual([
        {
          method: "detachTaskFromThread",
          input: { taskId: "task_1", threadId: "thr_test" },
        },
        {
          method: "detachTaskFromThread",
          input: { taskId: "task_1", threadId: "thr_two" },
        },
      ]),
    );
    remove.rendered.lifecycle.unmount();
  });

  it("does not detach any generic owner link when its replacement attach fails", async () => {
    const linked = { ...task, linkedThreadIds: ["thr_test", "thr_two"] };
    const { rendered, call } = await leftSlot(
      [linked],
      vi.fn((method) =>
        method === "attachTaskToThread"
          ? Promise.reject(new Error("owner replacement failed"))
          : Promise.resolve({}),
      ),
    );
    fireEvent.click(
      rendered.getByRole("button", { name: "Edit threads for WORK-1" }),
    );
    fireEvent.click(rendered.getByRole("option", { name: "Third thread" }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("attachTaskToThread", {
        taskId: "task_1",
        threadId: "thr_three",
      }),
    );
    await waitFor(() => expect(call).toHaveBeenCalledTimes(1));
    rendered.lifecycle.unmount();
  });

  it("does not offer deletion for a durable binding owned by another thread", async () => {
    const { rendered } = await leftSlot(
      [task],
      vi.fn(() => Promise.resolve({})),
      {
        thr_owner: [
          {
            task,
            threadId: "thr_owner",
            liveStatus: "working",
            role: "outcome",
            mode: null,
            idempotencyKey: null,
            dispatchState: null,
          },
        ],
      },
    );
    const row = rendered.getByRole("button", { name: "Open WORK-1 in Tasks" });
    expect(rendered.getByText("Owner thread unavailable")).toBeTruthy();
    expect(row.getAttribute("aria-describedby")).toBeTruthy();
    fireEvent.contextMenu(rendered.getByText(task.title));
    expect(
      rendered.getByRole("menuitem", { name: "Delete task" }),
    ).toHaveProperty("disabled", true);
    rendered.lifecycle.unmount();
  });

  it("reorders from context-menu keyboard controls with exact RPC and rollback", async () => {
    const pending = deferred<unknown>();
    const { rendered, call } = await leftSlot(
      [task, taskTwo],
      vi.fn((method) =>
        method === "reorderTask" ? pending.promise : Promise.resolve({}),
      ),
    );
    fireEvent.contextMenu(rendered.getByText(taskTwo.title));
    fireEvent.keyDown(rendered.getByRole("menuitem", { name: "Move up" }), {
      key: "Enter",
    });
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("reorderTask", {
        taskId: "task_2",
        beforeTaskId: null,
        afterTaskId: "task_1",
      }),
    );
    pending.reject(new Error("reorder failed"));
    await waitFor(() => expect(rendered.getByText(task.title)).toBeTruthy());
    fireEvent.contextMenu(rendered.getByText(task.title));
    fireEvent.keyDown(rendered.getByRole("menuitem", { name: "Move down" }), {
      key: " ",
    });
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("reorderTask", {
        taskId: "task_1",
        beforeTaskId: "task_2",
        afterTaskId: null,
      }),
    );
    rendered.lifecycle.unmount();
  });

  it("operates the registered Work item picker without assignee controls", async () => {
    const attach = deferred<unknown>();
    const call = vi.fn((method) =>
      method === "attachTaskToThread" ? attach.promise : Promise.resolve({}),
    );
    const captured = await app();
    const rendered = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      { rpc: rpcFixtures(() => tasks([task, taskTwo]), call) },
    );
    const combo = await openWorkItemPicker(rendered, "queue");
    fireEvent.focus(combo);
    fireEvent.change(combo, { target: { value: "second" } });
    fireEvent.click(rendered.getByRole("option", { name: /WORK-2/ }));
    await waitFor(() =>
      expect(call).toHaveBeenCalledWith("attachTaskToThread", {
        taskId: "task_2",
        threadId: "thr_test",
      }),
    );
    attach.resolve({});
    await waitFor(() =>
      expect(
        rendered.getByRole("combobox", { name: "Add a task to Goals" }),
      ).toBeTruthy(),
    );
    rendered.lifecycle.unmount();
    getPluginQueryClient().clear();

    const rightCall = vi.fn(() => Promise.resolve({}));
    const right = renderSlot(
      captured.threadPanelActions[0]!,
      { threadId: "thr_test", params: null },
      {
        rpc: rpcFixtures(
          () => tasks([{ ...task, linkedThreadIds: ["thr_test"] }]),
          rightCall,
        ),
      },
    );
    await waitFor(() =>
      expect(right.queryByRole("switch")).toBeNull(),
    );
    right.lifecycle.unmount();
  });
});
