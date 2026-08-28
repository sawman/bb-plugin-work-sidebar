// @vitest-environment jsdom
import type { PluginSidebarThread, PluginSidebarThreadsState } from "@get-bb/plugin-sdk/app";
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../../query-runtime";

const clipboardWrite = vi.fn(() => Promise.resolve());

const context = {
  tasksAvailable: true,
  currentThread: {
    title: "Parent work",
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

function thread(
  id: string,
  parentThreadId: string | null,
  overrides: Partial<PluginSidebarThread> = {},
): PluginSidebarThread {
  return {
    id,
    projectId: "project",
    title: id,
    titleFallback: null,
    parentThreadId,
    sectionId: null,
    originKind: "fork",
    originPluginId: "work-sidebar",
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
    ...overrides,
  };
}

function rpcFixture(overrides: Record<string, unknown> = {}) {
  return {
    getWorkContext: () => context,
    getChanges: () => ({
      currentPullRequest: null,
      stack: null,
      stackUnavailableReason: null,
      githubStack: null,
      repository: {
        outcome: "absent",
        message: "No repository",
        branch: null,
        base: null,
        ahead: 0,
        behind: 0,
        worktreeState: "clean",
        hasUncommittedChanges: false,
        changedFileCount: 0,
        changedInsertions: 0,
        changedDeletions: 0,
        changedFiles: [],
      },
    }),
    getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
    getWorkProviderStatus: () => ({ tone: "green", providerId: "codex", providerName: "Codex", statusUrl: null, status: "ready", message: null }),
    getWorkTracker: () => ({ visible: false, available: false, message: null, suggestions: [], items: [] }),
    getWorkStatus: () => ({ currentThread: context.currentThread, children: [] }),
    getLatestActivity: () => ({ currentThread: { status: "idle", runtimeStatus: "idle" }, latest: null, lastUser: null, current: null }),
    getWorkOutcome: () => ({ tasksAvailable: true, outcome: null, executionTasks: [], bindings: [], legacy: { state: "none", taskIds: [], message: null } }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkBackgroundJobs: () => ({ items: [] }),
    sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getAgentDetails: () => ({ agents: [] }),
    ...overrides,
  } as never;
}

async function agentsSlot(sidebarThreads: Partial<PluginSidebarThreadsState>, rpc = rpcFixture()) {
  getPluginQueryClient().clear();
  const app = await loadPluginApp(() => import("../../../app"));
  const slot = renderSlot(app.threadPanelActions[0]!, { threadId: "thr_root", params: null }, {
    rpc,
    sidebarThreads,
  });
  fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
  return slot;
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  clipboardWrite.mockReset();
});

describe("R15 registered Agents Work slot", () => {
  it("loads model metadata only while the Agents tab is active", async () => {
    getPluginQueryClient().clear();
    const getAgentDetails = vi.fn(() => ({
      agents: [{ threadId: "thr_child", model: "gpt-5.6-terra" }],
    }));
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_root", params: null },
      {
        rpc: rpcFixture({ getAgentDetails }),
        sidebarThreads: {
          status: "ready",
          threads: [thread("thr_root", null), thread("thr_child", "thr_root")],
        },
      },
    );

    expect(getAgentDetails).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    await waitFor(() => expect(slot.getByText("gpt-5.6-terra")).toBeTruthy());
    expect(getAgentDetails).toHaveBeenCalledOnce();
    slot.lifecycle.unmount();
  });

  it.each([
    ["loading", { status: "loading" as const }],
    ["error", { status: "error" as const }],
    ["empty", { status: "ready" as const, threads: [thread("thr_root", null)] }],
  ])("renders the host %s state", async (name, sidebarThreads) => {
    const slot = await agentsSlot(sidebarThreads);
    if (name === "loading") await waitFor(() => expect(slot.getByRole("status").textContent).toContain("Loading agents"));
    if (name === "error") await waitFor(() => expect(slot.getByRole("alert").textContent).toContain("Could not load agents"));
    if (name === "empty") await waitFor(() => expect(slot.getByText("No active delegated child threads are attached to this thread.")).toBeTruthy());
    slot.lifecycle.unmount();
  });

  it("renders direct and recursive live children, active status, and filters archived children", async () => {
    const slot = await agentsSlot({
      status: "ready",
      threads: [
        thread("thr_root", null),
        thread("thr_direct", "thr_root", { indicator: "runtime", activity: { workflows: 0, backgroundAgents: 1, backgroundCommands: 0, planMode: 0, goals: 0 } }),
        thread("thr_grandchild", "thr_direct", { indicator: "waiting-for-input", indicatorLabel: "Waiting for input", hasPendingInteraction: true }),
        thread("thr_archived", "thr_root", { isArchived: true }),
      ],
    });

    await waitFor(() => expect(slot.getByRole("link", { name: "Open thr_direct" })).toBeTruthy());
    expect(slot.getByRole("link", { name: "Open thr_grandchild" })).toBeTruthy();
    expect(slot.queryByText("thr_archived")).toBeNull();
    expect(slot.getByRole("img", { name: "Working" }).querySelector("rect")).toBeTruthy();
    expect(slot.getByRole("img", { name: "Waiting for input" })).toBeTruthy();
    expect(slot.queryByText("Working")).toBeNull();
    expect(slot.queryByText("Waiting")).toBeNull();
    expect(slot.getByText("2")).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("preserves linked task and recovery annotations without making the host roster server-owned", async () => {
    const slot = await agentsSlot(
      { status: "ready", threads: [thread("thr_root", null), thread("thr_child", "thr_root", { indicator: "runtime" })] },
      rpcFixture({
        sidebarTaskLinks: () => ({ available: true, links: { thr_child: [{ task: { id: "task_1", projectId: "project", projectName: "Work", key: "WORK-1", title: "Child task", status: "in_review", priority: "none", dueDate: null, parentTaskId: null }, threadId: "thr_child", liveStatus: "working", role: "execution", mode: "delegated", idempotencyKey: "child-1", dispatchState: "recovery_required" }] }, error: null }),
        getWorkOutcome: () => ({ tasksAvailable: true, outcome: null, executionTasks: [], bindings: [{ rootThreadId: "thr_root", outcomeTaskId: "outcome", taskProjectId: "project", executionTaskId: "task_1", ownerThreadId: "thr_child", mode: "delegated", idempotencyKey: "child-1", dispatchState: "recovery_required", recoveryMessage: "Recovery required before retry." }], legacy: { state: "none", taskIds: [], message: null } }),
      }),
    );
    await waitFor(() => expect(slot.getByRole("link", { name: "Open thr_child" })).toBeTruthy());
    await waitFor(() => expect(slot.getByRole("img", { name: "Working" })).toBeTruthy());
    expect(slot.queryByText("Working · Recovery Required")).toBeNull();
    expect(slot.getByText("WORK-1")).toBeTruthy();
    expect(slot.getByText("Child task")).toBeTruthy();
    expect(slot.getByText("Recovery required before retry.")).toBeTruthy();
    expect(slot.getByRole("article").classList.contains("ws-agent-review")).toBe(true);
    slot.lifecycle.unmount();
  });

  it("shows each agent's resolved model, worktree and branch, and complete linked task", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const slot = await agentsSlot(
      {
        status: "ready",
        threads: [
          thread("thr_root", null),
          thread("thr_child", "thr_root", {
            indicator: "runtime",
            environment: {
              id: "env_agents",
              name: "Agents worktree",
              branchName: "bb/agents-details",
              workspaceDisplayKind: "managed-worktree",
            },
          }),
        ],
      },
      rpcFixture({
        getAgentDetails: () => ({
          agents: [{ threadId: "thr_child", model: "claude-opus-5[1m]" }],
        }),
        sidebarTaskLinks: () => ({
          available: true,
          links: {
            thr_child: [{
              task: {
                id: "task_1",
                projectId: "project",
                projectName: "bbplug",
                key: "BBPLUG-52",
                title: "Enhance the sidebar Agents view",
                status: "in_progress",
                priority: "medium",
                dueDate: null,
                parentTaskId: null,
              },
              threadId: "thr_child",
              liveStatus: "working",
              role: "execution",
              mode: "delegated",
              idempotencyKey: "agents-details",
              dispatchState: "ready",
            }],
          },
          error: null,
        }),
      }),
    );

    await waitFor(() => expect(slot.getByText("claude-opus-5[1m]")).toBeTruthy());
    expect(slot.getByText("bb/agents-details")).toBeTruthy();
    expect(slot.getByText("Agents worktree")).toBeTruthy();
    const workspace = slot.getByRole("button", {
      name: "Copy agent workspace bb/agents-details",
    });
    fireEvent.click(workspace);
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith(
        "Branch bb/agents-details · Worktree Agents",
      ),
    );
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    expect(slot.getByText("BBPLUG-52")).toBeTruthy();
    expect(slot.getByText("Enhance the sidebar Agents view")).toBeTruthy();
    expect(slot.getByRole("img", { name: "Working" }).classList).toContain(
      "ws-agent-state-working",
    );
    slot.lifecycle.unmount();
  });

  it("keeps agent rows usable when model details are unavailable", async () => {
    const slot = await agentsSlot(
      {
        status: "ready",
        threads: [thread("thr_root", null), thread("thr_child", "thr_root")],
      },
      rpcFixture({
        getAgentDetails: () => Promise.reject(new Error("models unavailable")),
      }),
    );
    await waitFor(() => expect(slot.getByRole("link", { name: "Open thr_child" })).toBeTruthy());
    expect(slot.getByText("Model unavailable")).toBeTruthy();
    expect(slot.getByRole("img", { name: "Idle" }).querySelectorAll("path")).toHaveLength(3);
    expect(slot.queryByRole("alert")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("does not render dispatch state from an unbound task link", async () => {
    const slot = await agentsSlot(
      { status: "ready", threads: [thread("thr_root", null), thread("thr_unbound", "thr_root", { indicator: "runtime" })] },
      rpcFixture({
        sidebarTaskLinks: () => ({ available: true, links: { thr_unbound: [{ task: { id: "task_2", projectId: "project", projectName: "Work", key: "WORK-2", title: "Unbound task", status: "in_review", priority: "none", dueDate: null, parentTaskId: null }, threadId: "thr_unbound", liveStatus: "working", role: "execution", mode: "delegated", idempotencyKey: "unbound-1", dispatchState: "recovery_required" }] }, error: null }),
      }),
    );
    await waitFor(() => expect(slot.getByRole("link", { name: "Open thr_unbound" })).toBeTruthy());
    await waitFor(() => expect(slot.getByRole("img", { name: "Working" })).toBeTruthy());
    expect(slot.queryByText("Working")).toBeNull();
    expect(slot.getByText("WORK-2")).toBeTruthy();
    expect(slot.getByText("Unbound task")).toBeTruthy();
    expect(slot.getByRole("article").classList.contains("ws-agent-review")).toBe(true);
    expect(slot.queryByText("Recovery Required")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("keeps host Agents visible when task metadata queries fail", async () => {
    const slot = await agentsSlot(
      { status: "ready", threads: [thread("thr_root", null), thread("thr_child", "thr_root")] },
      rpcFixture({
        sidebarTaskLinks: () => Promise.reject(new Error("tasks unavailable")),
        getWorkOutcome: () => Promise.reject(new Error("bindings unavailable")),
      }),
    );
    await waitFor(() => expect(slot.getByRole("link", { name: "Open thr_child" })).toBeTruthy());
    expect(slot.queryByRole("alert")).toBeNull();
    slot.lifecycle.unmount();
  });

  it("uses shared task-link data without adding a second polling observer", async () => {
    vi.useFakeTimers();
    let reads = 0;
    const slot = await agentsSlot(
      { status: "ready", threads: [thread("thr_root", null), thread("thr_child", "thr_root")] },
      rpcFixture({
        sidebarTaskLinks: () => {
          reads += 1;
          return { available: true, links: {}, error: null };
        },
      }),
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
      await Promise.resolve();
    });
    expect(reads).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(reads).toBe(1);
    slot.lifecycle.unmount();
    vi.useRealTimers();
  });

  it("uses host open actions for normal, modifier, explicit open, split, and shortcut navigation", async () => {
    const slot = await agentsSlot({
      status: "ready",
      threads: [
        thread("thr_root", null),
        thread("thr_child", "thr_root", {
          createdAt: Date.now() - 65_000,
          environment: {
            id: "env_child",
            name: "Agent checkout",
            branchName: "bb/agent-child",
            workspaceDisplayKind: "managed-worktree",
          },
        }),
      ],
    });
    const link = await slot.findByRole("link", { name: "Open thr_child" });
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_child");

    fireEvent.click(link);
    fireEvent.click(link, { ctrlKey: true });
    fireEvent.click(slot.getByRole("button", { name: "Open thr_child" }));
    fireEvent.click(slot.getByRole("button", { name: "Open thr_child in split" }));

    expect(slot.getByText("1m 5s").getAttribute("title")).toBe("Agent thread age");
    expect(slot.getByTitle("Agent checkout worktree: bb/agent-child").getAttribute("data-workspace-kind")).toBe("managed-worktree");
    expect(slot.inspection.sidebarActionCalls).toEqual([
      { method: "open", threadId: "thr_child", options: { split: false } },
      { method: "open", threadId: "thr_child", options: { split: true } },
      { method: "open", threadId: "thr_child", options: { split: false } },
      { method: "open", threadId: "thr_child", options: { split: true } },
    ]);
    slot.lifecycle.unmount();
  });
});
