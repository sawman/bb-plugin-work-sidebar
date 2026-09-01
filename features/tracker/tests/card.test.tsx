// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { configureAxe } from "vitest-axe";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const unlinked = {
  visible: true,
  available: true,
  message: null,
  primaryKey: null,
  suggestions: [
    { key: "LIN-1", title: "Suggested", url: "https://linear.app/issue/LIN-1" },
  ],
  items: [],
};
const linked = {
  ...unlinked,
  items: [
    {
      item: {
        key: "LIN-1",
        title: "Suggested",
        url: "https://linear.app/issue/LIN-1",
        status: "Todo",
        stateCategory: "todo" as const,
        priority: null,
        assignee: null,
        project: null,
      },
      statusOptions: [
        { id: "todo", name: "Todo", current: true },
        { id: "done", name: "Done", current: false },
      ],
    },
  ],
};
const multiLinked = {
  ...unlinked,
  suggestions: [],
  items: [
    linked.items[0],
    {
      item: {
        ...linked.items[0].item,
        key: "LIN-2",
        title: "Second linked issue",
        url: "https://linear.app/issue/LIN-2",
      },
      statusOptions: linked.items[0].statusOptions,
    },
  ],
};
const context = {
  tasksAvailable: true,
  currentThread: {
    title: "Fixture",
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
};

function fixture(overrides: Partial<Rpc> = {}): Rpc {
  return {
    getWorkContext: () => context,
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
    sidebarTasks: () => ({
      available: true,
      tasks: [],
      projects: [],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getWorkStatus: () => ({
      currentThread: context.currentThread,
      children: [],
    }),
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkOutcome: () => ({
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
    }),
    getWorkItemQueue: () => ({
      rootThreadId: "thr_fixture",
      configured: false,
      queue: { current: null, backlog: [] },
    }),
    saveWorkItemQueue: () => ({
      rootThreadId: "thr_fixture",
      configured: true,
      queue: { current: null, backlog: [] },
    }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkBackgroundJobs: () => ({ items: [] }),
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
    getWorkTracker: () => unlinked,
    searchLinearIssues: () => ({ items: [] }),
    ...overrides,
  } as Rpc;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((ok, bad) => {
    resolve = ok;
    reject = bad;
  });
  return { promise, resolve, reject };
}

async function expectNoAriaViolations(container: HTMLElement) {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}
async function openLinearSearch(slot: ReturnType<typeof renderSlot>) {
  return slot.findByLabelText("Add a task to Goals");
}
afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("registered tracker card", () => {
  it("projects an unconfigured root's linked Linear goals and offers an adjacent add control", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_multi_tracker", params: null },
      {
        rpc: fixture({
          getWorkTracker: () => multiLinked,
        }),
      },
    );

    expect(await slot.findByRole("combobox", { name: "Add a task to Goals" })).toBeTruthy();
    const workQueue = slot.getByRole("region", { name: "Work queue" });
    expect(within(workQueue).getByText(/Suggested/)).toBeTruthy();
    expect(within(workQueue).getByText(/Second linked issue/)).toBeTruthy();
    expect(slot.queryByRole("button", { name: /Unlink/ })).toBeNull();
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("keeps populated tracker suggestions ARIA-valid with selected option semantics", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_populated_tracker", params: null },
      { rpc: fixture() },
    );
    fireEvent.focus(await openLinearSearch(slot));
    const option = await slot.findByRole("option", { name: /LIN-1/ });
    expect(option.textContent).toContain("LIN-1");
    expect(option.getAttribute("aria-selected")).toBe("false");
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("keeps an available tracker with no suggestions ARIA-valid without an empty listbox", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_empty_tracker", params: null },
      { rpc: fixture({ getWorkTracker: () => ({ ...unlinked, suggestions: [] }) }) },
    );
    fireEvent.focus(await openLinearSearch(slot));
    await waitFor(() => expect(slot.getByText("No matching BB or Linear tasks.")).toBeTruthy());
    await expectNoAriaViolations(slot.container);
    expect(slot.queryByRole("listbox", { name: "Available BB and Linear tasks" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("dedupes header/card context and debounces search through actual Query hooks", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkTracker = vi.fn(() => unlinked);
    const searchLinearIssues = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_tracker", params: null },
      { rpc: fixture({ getWorkTracker, searchLinearIssues }) },
    );
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(1));
    fireEvent.change(await openLinearSearch(slot), {
      target: { value: "LIN" },
    });
    await waitFor(
      () =>
        expect(searchLinearIssues).toHaveBeenCalledWith({
          threadId: "thr_tracker",
          query: "LIN",
        }),
      { timeout: 1_000 },
    );
    expect(
      slot.queryByRole("listbox", { name: "Suggested Linear issues" }),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("keeps Work siblings while tracker is loading, unavailable, non-Linear, or malformed", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    for (const result of [
      new Promise<never>(() => undefined),
      { ...unlinked, available: false, message: "Taskboard absent" },
      { ...unlinked, visible: false },
      undefined,
    ]) {
      getPluginQueryClient().clear();
      const slot = renderSlot(
        app.threadPanelActions[0]!,
        { threadId: `thr_${Math.random()}`, params: null },
        { rpc: fixture({ getWorkTracker: () => result as never }) },
      );
      await waitFor(() => expect(slot.getByText("Status")).toBeTruthy());
      expect(slot.getByText("Work items")).toBeTruthy();
      slot.lifecycle.unmount();
    }
  });

  it("scopes a rejected tracker query to Linear and retries while the BB outcome remains visible", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const retryAttempt = deferred<typeof unlinked>();
    let recover = false;
    const getWorkTracker = vi.fn(() => {
      if (recover) return Promise.resolve(unlinked);
      if (getWorkTracker.mock.calls.length === 1) {
        return Promise.reject(new Error("tracker unavailable"));
      }
      return retryAttempt.promise;
    });
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_tracker_error", params: null }, {
      rpc: fixture({
        getWorkTracker,
        getWorkOutcome: () => ({ rootThreadId: "thr_tracker_error", tasksAvailable: true, outcome: { id: "task_1", projectId: "project", projectName: "Work", key: "WORK-1", title: "Keep outcome", status: "todo", priority: "none", dueDate: null, parentTaskId: null, position: 1 }, executionTasks: [], bindings: [], legacy: { state: "none", taskIds: [], message: null } }),
      }),
    });
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(2), { timeout: 3_000 });
    expect(slot.getByText("Keep outcome")).toBeTruthy();
    expect(slot.queryByRole("alert")).toBeNull();
    retryAttempt.reject(new Error("tracker unavailable"));
    await waitFor(
      () => expect(slot.getByRole("alert").textContent).toContain("tracker unavailable"),
      { timeout: 3_000 },
    );
    const terminalCallCount = getWorkTracker.mock.calls.length;
    recover = true;
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(terminalCallCount + 1));
    expect(getWorkTracker).toHaveBeenLastCalledWith({ threadId: "thr_tracker_error" });
    await waitFor(() => expect(slot.queryByRole("alert")).toBeNull());
    expect(slot.getByText("Keep outcome")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("uses the exact link RPC and restores its disabled option after rejection", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const link = deferred<{ key: string; title: string }>();
    const linkLinearIssue = vi.fn(() => link.promise);
    const getWorkTracker = vi.fn(() => unlinked);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_mutate", params: null },
      { rpc: fixture({ getWorkTracker, linkLinearIssue }) },
    );
    fireEvent.focus(await openLinearSearch(slot));
    await waitFor(() => expect(slot.getByText("Suggested")).toBeTruthy());
    fireEvent.click(slot.getByText("Suggested"));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "linkLinearIssue",
        ),
      ).toHaveLength(1),
    );
    expect(
      slot.inspection.rpcCalls.find((call) => call.method === "linkLinearIssue")
        ?.input,
    ).toEqual({ threadId: "thr_mutate", key: "LIN-1" });
    expect(slot.getByRole("combobox", { name: "Add a task to Goals" })).toBeTruthy();
    expect(slot.queryByRole("listbox", { name: "Available BB and Linear tasks" })).toBeNull();
    link.reject(new Error("link failed"));
    await waitFor(() =>
      expect(slot.getByRole("combobox", { name: "Add a task to Goals" })).toBeTruthy(),
    );
    expect(toast.error).toHaveBeenCalledWith("link failed");
    slot.lifecycle.unmount();
  });

  it("does not claim a Linear Goal was saved when queue persistence fails", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const link = deferred<{ key: string; title: string }>();
    const queue = deferred<{
      rootThreadId: string;
      configured: boolean;
      queue: { current: null; backlog: [] };
    }>();
    const linkLinearIssue = vi.fn(() => link.promise);
    const saveWorkItemQueue = vi.fn(() => queue.promise);
    const events: string[] = [];
    toast.success.mockImplementation((message: string) => events.push(`success:${message}`));
    toast.error.mockImplementation((message: string) => events.push(`error:${message}`));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_linear_backlog_toasts", params: null },
      { rpc: fixture({ linkLinearIssue, saveWorkItemQueue }) },
    );

    fireEvent.focus(await openLinearSearch(slot));
    await waitFor(() => expect(slot.getByText("Suggested")).toBeTruthy());
    fireEvent.click(slot.getByText("Suggested"));
    link.resolve({ key: "LIN-1", title: "Suggested" });
    await waitFor(() => expect(saveWorkItemQueue).toHaveBeenCalledOnce());
    queue.reject(new Error("queue failed"));

    await waitFor(() => expect(events).toEqual(["error:queue failed"]));
    slot.lifecycle.unmount();
  });

  it("creates the BB outcome from the primary Linear issue with the mapped priority", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const createWorkTask = vi.fn(() => ({ task: {} } as never));
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_linear_only", params: null }, {
      rpc: fixture({
        getWorkTracker: () => ({ ...linked, primaryKey: "LIN-1", items: [{ ...linked.items[0], item: { ...linked.items[0].item, priority: "High" } }] }),
        createWorkTask,
      }),
    });
    await waitFor(() => expect(slot.getByRole("button", { name: "Create BB task from LIN-1" })).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Create BB task from LIN-1" }));
    await waitFor(() => expect(createWorkTask).toHaveBeenCalledWith({
      threadId: "thr_linear_only", title: "Suggested", priority: "high",
      description: "Created from the Work sidebar.", parentTaskId: null,
    }));
    slot.lifecycle.unmount();
  });

  it("moves a linked Linear issue into the current goal with busy error recovery", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const queue = deferred<{
      rootThreadId: string;
      configured: boolean;
      queue: { current: null; backlog: [] };
    }>();
    const saveWorkItemQueue = vi.fn(() => queue.promise);
    const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_primary", params: null }, {
      rpc: fixture({ getWorkTracker: () => ({ ...multiLinked, primaryKey: "LIN-1" }), saveWorkItemQueue }),
    });
    const makeCurrent = await slot.findAllByRole("button", { name: "Make current" });
    expect(makeCurrent[0]?.closest(".ws-work-item-queue-actions")).toBeTruthy();
    expect(
      makeCurrent[0]?.parentElement?.querySelector('[aria-label="Start task"]'),
    ).toBeTruthy();
    fireEvent.click(makeCurrent[0]!);
    await waitFor(() => expect(saveWorkItemQueue).toHaveBeenCalledWith({
      threadId: "thr_primary",
      queue: {
        current: { source: "linear", id: "LIN-2" },
        backlog: [{ source: "linear", id: "LIN-1" }],
      },
    }));
    expect((makeCurrent[0] as HTMLButtonElement).disabled).toBe(true);
    queue.reject(new Error("queue failed"));
    await waitFor(() => expect((slot.getAllByRole("button", { name: "Make current" })[0] as HTMLButtonElement).disabled).toBe(false));
    expect(toast.error).toHaveBeenCalledWith("queue failed");
    slot.lifecycle.unmount();
  });

  it("updates the current Linear goal status from the Work item card", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const status = deferred<{ key: string; status: string }>();
    const updateLinearIssueStatus = vi.fn(() => status.promise);
    const getWorkTracker = vi.fn(() => linked);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_linked", params: null },
      {
        rpc: fixture({
          getWorkTracker,
          updateLinearIssueStatus,
        }),
      },
    );
    await waitFor(() =>
      expect(slot.getByLabelText("LIN-1 status")).toBeTruthy(),
    );
    fireEvent.change(slot.getByLabelText("LIN-1 status"), {
      target: { value: "done" },
    });
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "updateLinearIssueStatus",
        ),
      ).toHaveLength(1),
    );
    expect(
      slot.inspection.rpcCalls.find(
        (call) => call.method === "updateLinearIssueStatus",
      )?.input,
    ).toEqual({ threadId: "thr_linked", key: "LIN-1", statusId: "done" });
    expect(
      (slot.getByLabelText("LIN-1 status") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    status.resolve({ key: "LIN-1", status: "Done" });
    await waitFor(() =>
      expect(
        (slot.getByLabelText("LIN-1 status") as HTMLSelectElement)
          .disabled,
      ).toBe(false),
    );
    expect(toast.success).toHaveBeenCalledWith("LIN-1 moved to Done");
    slot.lifecycle.unmount();
  });

  it("refetches the actual tracker query exactly once for one realtime event", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkTracker = vi.fn(() => unlinked);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_realtime", params: null },
      { rpc: fixture({ getWorkTracker }) },
    );
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(1));
    await slot.behavior.emitRealtime("work-sidebar:changed", {
      family: "tracker",
      threadId: "thr_realtime",
    });
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(2));
    slot.lifecycle.unmount();
  });

  it("releases the tracker observer when Work is inactive and remounts it on return", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const client = getPluginQueryClient();
    const getWorkTracker = vi.fn(() => linked);
    const threadId = "thr_inactive_tracker";
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId, params: null },
      { rpc: fixture({ getWorkTracker }) },
    );
    const key = ["work-sidebar", "tracker", "context", threadId];

    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(1));
    expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(1);

    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    await waitFor(() =>
      expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(0),
    );

    fireEvent.click(slot.getByRole("tab", { name: "Work" }));
    await waitFor(() =>
      expect(client.getQueryCache().find({ queryKey: key })?.getObserversCount()).toBe(1),
    );
    // A fresh context remains cached across Work-tab activation; stale data,
    // manual refresh, realtime invalidation, and error retry have dedicated
    // query-policy coverage below.
    expect(getWorkTracker).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
  });

  it("uses BB navigation for the global Linear header badge", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_nav", params: null },
      { rpc: fixture({ getWorkTracker: () => linked }) },
    );
    await waitFor(() =>
      expect(slot.getByLabelText("LIN-1 status")).toBeTruthy(),
    );
    const headerBadge = slot.getByRole("button", { name: "LIN-1" });
    expect(headerBadge.classList).toContain("ws-identifier-badge");
    fireEvent.click(headerBadge);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openUrl", url: linked.items[0].item.url },
    ]);
    slot.lifecycle.unmount();
  });

  it("shows a retry:1 search failure and recovers through the search retry button", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const searchLinearIssues = vi
      .fn()
      .mockRejectedValueOnce(new Error("search down"))
      .mockRejectedValueOnce(new Error("search down"))
      .mockResolvedValue({
        items: [
          {
            key: "LIN-9",
            title: "Recovered",
            url: "https://linear.app/issue/LIN-9",
          },
        ],
      });
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_search", params: null },
      { rpc: fixture({ searchLinearIssues }) },
    );
    fireEvent.change(await openLinearSearch(slot), {
      target: { value: "LIN-9" },
    });
    await waitFor(
      () =>
        expect(slot.getByRole("alert").textContent).toContain("search down"),
      { timeout: 3_000 },
    );
    expect(searchLinearIssues).toHaveBeenCalledTimes(2);
    fireEvent.click(slot.getByRole("button", { name: "Try again" }));
    await waitFor(
      () =>
        expect(slot.getByRole("option", { name: /Recovered/ })).toBeTruthy(),
      { timeout: 3_000 },
    );
    expect(searchLinearIssues).toHaveBeenCalledTimes(3);
    slot.lifecycle.unmount();
  });

  it("uses only the server realtime event when a mutation publishes before resolving", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkTracker = vi.fn(() => linked);
    let slot!: ReturnType<typeof renderSlot>;
    const updateLinearIssueStatus = vi.fn(async () => {
      await slot.behavior.emitRealtime("work-sidebar:changed", {
        family: "tracker",
        threadId: "thr_collision",
      });
      return { key: "LIN-1", status: "Done" };
    });
    slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_collision", params: null },
      { rpc: fixture({ getWorkTracker, updateLinearIssueStatus }) },
    );
    await waitFor(() =>
      expect(slot.getByLabelText("LIN-1 status")).toBeTruthy(),
    );
    expect(getWorkTracker).toHaveBeenCalledTimes(1);
    fireEvent.change(slot.getByLabelText("LIN-1 status"), {
      target: { value: "done" },
    });
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(getWorkTracker).toHaveBeenCalledTimes(2);
    slot.lifecycle.unmount();
  });
});
