// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { RenderSlotOptions } from "@get-bb/plugin-sdk/testing/app";
import type { rpcContract } from "../../../contracts";
import { getPluginQueryClient } from "../../../query-runtime";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));

type Rpc = NonNullable<RenderSlotOptions<typeof rpcContract>["rpc"]>;
const unlinked = {
  visible: true,
  available: true,
  message: null,
  suggestions: [
    { key: "LIN-1", title: "Suggested", url: "https://linear.app/issue/LIN-1" },
  ],
  item: null,
  statusOptions: [],
};
const linked = {
  ...unlinked,
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
afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("registered tracker card", () => {
  it("dedupes header/card context and debounces search through actual Query hooks", async () => {
    vi.useFakeTimers();
    const app = await loadPluginApp(() => import("../../../app"));
    const getWorkTracker = vi.fn(() => unlinked);
    const searchLinearIssues = vi.fn(() => ({ items: [] }));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_tracker", params: null },
      { rpc: fixture({ getWorkTracker, searchLinearIssues }) },
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(getWorkTracker).toHaveBeenCalledTimes(1);
    fireEvent.change(slot.getByLabelText("Search Linear issues"), {
      target: { value: "LIN" },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(179);
    });
    expect(searchLinearIssues).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(searchLinearIssues).toHaveBeenCalledWith({
      threadId: "thr_tracker",
      query: "LIN",
    });
    expect(
      slot.getByRole("listbox", { name: "Suggested Linear issues" }),
    ).toBeTruthy();
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
      expect(slot.getByText("Tasks")).toBeTruthy();
      expect(slot.getByText("Outcome")).toBeTruthy();
      slot.lifecycle.unmount();
    }
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
    expect((slot.getByRole("option") as HTMLButtonElement).disabled).toBe(true);
    link.reject(new Error("link failed"));
    await waitFor(() =>
      expect((slot.getByRole("option") as HTMLButtonElement).disabled).toBe(
        false,
      ),
    );
    expect(toast.error).toHaveBeenCalledWith("link failed");
    slot.lifecycle.unmount();
  });

  it("issues exact linked status and unlink RPCs with disabled controls and targeted refreshes", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const status = deferred<{ key: string; status: string }>();
    const unlink = deferred<{ ok: true }>();
    const updateLinearIssueStatus = vi.fn(() => status.promise);
    const getWorkTracker = vi.fn(() => linked);
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_linked", params: null },
      {
        rpc: fixture({
          getWorkTracker,
          updateLinearIssueStatus,
          unlinkLinearIssue: () => unlink.promise,
        }),
      },
    );
    await waitFor(() =>
      expect(slot.getByLabelText("Linear issue status")).toBeTruthy(),
    );
    fireEvent.change(slot.getByLabelText("Linear issue status"), {
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
    ).toEqual({ threadId: "thr_linked", statusId: "done" });
    expect(
      (slot.getByLabelText("Linear issue status") as HTMLSelectElement)
        .disabled,
    ).toBe(true);
    status.resolve({ key: "LIN-1", status: "Done" });
    await waitFor(() =>
      expect(
        (slot.getByLabelText("Linear issue status") as HTMLSelectElement)
          .disabled,
      ).toBe(false),
    );
    expect(toast.success).toHaveBeenCalledWith("LIN-1 moved to Done");
    fireEvent.click(slot.getByRole("button", { name: "Unlink" }));
    await waitFor(() =>
      expect(
        slot.inspection.rpcCalls.filter(
          (call) => call.method === "unlinkLinearIssue",
        ),
      ).toHaveLength(1),
    );
    expect(
      slot.inspection.rpcCalls.find(
        (call) => call.method === "unlinkLinearIssue",
      )?.input,
    ).toEqual({ threadId: "thr_linked" });
    expect(
      (slot.getByRole("button", { name: "Unlink" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    unlink.reject(new Error("unlink failed"));
    await waitFor(() =>
      expect(
        (slot.getByRole("button", { name: "Unlink" }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(toast.error).toHaveBeenCalledWith("unlink failed");
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

  it("uses BB navigation for both the header badge and linked issue", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_nav", params: null },
      { rpc: fixture({ getWorkTracker: () => linked }) },
    );
    await waitFor(() =>
      expect(slot.getByLabelText("Linear issue status")).toBeTruthy(),
    );
    fireEvent.click(slot.getAllByText("LIN-1")[0]!);
    fireEvent.click(slot.container.querySelector(".ws-linear-issue")!);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "openUrl", url: linked.item.url },
      { method: "openUrl", url: linked.item.url },
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
    await waitFor(() =>
      expect(slot.getByLabelText("Search Linear issues")).toBeTruthy(),
    );
    fireEvent.change(slot.getByLabelText("Search Linear issues"), {
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
      expect(slot.getByLabelText("Linear issue status")).toBeTruthy(),
    );
    expect(getWorkTracker).toHaveBeenCalledTimes(1);
    fireEvent.change(slot.getByLabelText("Linear issue status"), {
      target: { value: "done" },
    });
    await waitFor(() => expect(getWorkTracker).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => window.setTimeout(resolve, 20));
    expect(getWorkTracker).toHaveBeenCalledTimes(2);
    slot.lifecycle.unmount();
  });
});
