// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../query-runtime";

// The fixture gate is deliberately scoped to ARIA validity and accessible
// name/role/value semantics. This keeps jsdom's non-layout canvas from
// pretending to evaluate color contrast while leaving every relevant axe rule
// enabled rather than suppressing individual findings.
const axe = configureAxe({
  runOnly: { type: "tag", values: ["cat.aria", "cat.name-role-value"] },
});

const host = vi.hoisted(() => ({
  sidebarThreads: { status: "ready", projects: [], threads: [] } as unknown,
}));

vi.mock("@get-bb/plugin-sdk/app", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@get-bb/plugin-sdk/app")>()),
  experimental_useSidebarThreads: () => host.sidebarThreads,
}));

const task = {
  id: "task_1",
  projectId: "project_1",
  projectName: "Project",
  key: "PROJ-1",
  title: "Accessible task",
  status: "todo",
  priority: "medium",
  dueDate: null,
  parentTaskId: null,
  position: 1,
  linkedThreadIds: [],
  assignee: "human",
};

function fixture() {
  return {
    getSidebarOrder: () => ({ threadIds: ["thr_accessible"] }),
    getThreadGroups: () => ({
      groups: [{ id: "group_later", name: "Later", threadIds: [] }],
    }),
    saveThreadGroups: ({ groups }: { groups: unknown[] }) => ({ groups }),
    saveSiblingOrder: ({ threadIds }: { threadIds: string[] }) => ({
      threadIds,
    }),
    sidebarArchivedThreads: () => ({
      available: true,
      threads: [],
      error: null,
    }),
    sidebarTasks: () => ({
      available: true,
      tasks: [task],
      projects: [{ id: "project_1", name: "Project" }],
      error: null,
    }),
    sidebarTaskLinks: () => ({
      available: true,
      links: {
        thr_agent: [
          {
            task: {
              ...task,
              id: "task_agent",
              key: "PROJ-4",
              title: "Accessible delegated task",
              assignee: "agent",
            },
            threadId: "thr_agent",
            liveStatus: "working",
            role: "execution",
            mode: "delegated",
            idempotencyKey: "accessible-agent",
            dispatchState: "ready",
          },
        ],
      },
      error: null,
    }),
    getAgentDetails: () => ({
      agents: [{ threadId: "thr_agent", model: "gpt-5.6-terra" }],
    }),
    sidebarAuthoredPullRequests: () => ({
      available: true,
      pullRequests: [
        {
          url: "https://github.com/acme/repo/pull/1",
          number: 1,
          title: "Accessible PR",
          repository: "acme/repo",
          head: "feature",
          base: "main",
          state: "open",
          draft: false,
          checks: "passing",
          review: "none",
          reviewCommentCount: 0,
          stack: null,
        },
      ],
      error: null,
    }),
    sidebarAuthoredPullRequestStacks: () => ({
      available: true,
      pullRequests: [
        {
          url: "https://github.com/acme/repo/pull/1",
          number: 1,
          title: "Accessible PR",
          repository: "acme/repo",
          head: "feature",
          base: "main",
          state: "open",
          draft: false,
          checks: "passing",
          review: "none",
          reviewCommentCount: 0,
          stack: null,
        },
      ],
      error: null,
    }),
    getGitHubApiHealth: () => ({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    }),
    getWorkStatus: () => ({
      currentThread: {
        title: "Accessible work",
        status: "idle",
        runtimeStatus: "idle",
        providerId: "codex",
      },
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
      outcome: {
        id: "outcome_1",
        key: "PROJ-2",
        title: "Accessible outcome",
        status: "in_progress",
        priority: "medium",
        dueDate: null,
      },
      executionTasks: [
        {
          id: "execution_1",
          key: "PROJ-3",
          title: "Accessible execution task",
          status: "todo",
          assignee: "agent",
          ownerThreadId: "thr_accessible",
        },
      ],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
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
    getWorkTracker: () => ({
      visible: false,
      available: false,
      message: null,
      suggestions: [],
      items: [],
    }),
    getChanges: () => ({
      currentPullRequest: null,
      stack: null,
      stackUnavailableReason: null,
      githubStack: null,
      repository: {
        outcome: "available",
        message: null,
        branch: "main",
        base: "main",
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
  } as never;
}

async function expectNoAriaViolations(container: HTMLElement) {
  const results = await axe(container);
  expect(results.violations).toEqual([]);
  expect(results.incomplete).toEqual([]);
}

function expectTabRelationships(container: HTMLElement) {
  for (const tab of container.querySelectorAll<HTMLElement>('[role="tab"]')) {
    const panelId = tab.getAttribute("aria-controls");
    const panel = panelId ? container.querySelector(`#${panelId}`) : null;
    expect(panel, `${tab.id} must control a present panel`).toBeTruthy();
    expect(panel?.getAttribute("aria-labelledby")).toBe(tab.id);
  }
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
});

describe("R19D registered slot accessibility", () => {
  it("keeps representative Threads, Tasks, and PRs slot states ARIA-valid", async () => {
    host.sidebarThreads = {
      status: "ready",
      projects: [{ id: "project_1", name: "Project", isPersonal: false }],
      threads: [
        {
          id: "thr_accessible",
          projectId: "project_1",
          title: "Accessible thread",
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
        },
      ],
    };
    const app = await loadPluginApp(() => import("../../app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: "thr_accessible",
        activeProjectId: "project_1",
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => null,
      },
      { rpc: fixture() },
    );
    const threadLink = await slot.findByRole("link", {
      name: /Accessible thread/,
    });
    fireEvent.click(threadLink, { ctrlKey: true });
    await waitFor(() =>
      expect(threadLink.getAttribute("data-selected")).toBe("true"),
    );
    expect(threadLink.getAttribute("aria-current")).toBe("true");
    expect(threadLink.hasAttribute("aria-selected")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Search threads" }));
    fireEvent.change(slot.getByRole("searchbox", { name: "Search threads" }), {
      target: { value: "Accessible" },
    });
    await expectNoAriaViolations(slot.container);
    fireEvent.keyDown(slot.getByRole("searchbox", { name: "Search threads" }), {
      key: "Escape",
    });
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    await waitFor(() =>
      expect(
        slot.getByRole("dialog", { name: "Thread list settings" }),
      ).toBeTruthy(),
    );
    const appearance = slot.container.querySelector(
      ".ws-thread-appearance-settings",
    );
    expect(
      appearance?.querySelectorAll(".ws-thread-appearance-entry"),
    ).toHaveLength(3);
    expect(appearance?.querySelectorAll("strong, b")).toHaveLength(0);
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(slot.getByText("Accessible task")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Search tasks" }));
    fireEvent.change(slot.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "Accessible" },
    });
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(slot.getByText("Accessible PR")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Search pull requests" }));
    fireEvent.change(
      slot.getByRole("searchbox", { name: "Search pull requests" }),
      { target: { value: "Accessible" } },
    );
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("keeps representative Work, Changes, and Agents slot states ARIA-valid", async () => {
    host.sidebarThreads = {
      status: "ready",
      projects: [],
      threads: [
        {
          id: "thr_accessible",
          projectId: "project_1",
          title: "Accessible work",
          titleFallback: null,
          parentThreadId: null,
          sectionId: null,
          originKind: null,
          originPluginId: null,
          providerId: "codex",
          hasPendingInteraction: false,
          activity: {
            workflows: 0,
            backgroundAgents: 1,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
          indicator: "runtime",
          indicatorLabel: "Agent is working",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          environment: null,
          host: null,
          createdAt: 0,
          updatedAt: 0,
          lastReadAt: null,
          latestAttentionAt: 0,
        },
        {
          id: "thr_agent",
          projectId: "project_1",
          title: "Accessible agent",
          titleFallback: null,
          parentThreadId: "thr_accessible",
          sectionId: null,
          originKind: "fork",
          originPluginId: "work-sidebar",
          providerId: "codex",
          hasPendingInteraction: false,
          activity: {
            workflows: 0,
            backgroundAgents: 1,
            backgroundCommands: 0,
            planMode: 0,
            goals: 0,
          },
          indicator: "runtime",
          indicatorLabel: "Agent is working",
          isUnread: false,
          isPinned: false,
          isArchived: false,
          environment: {
            id: "env_agent",
            name: "Accessible worktree",
            branchName: "bb/accessible-agent",
            workspaceDisplayKind: "managed-worktree",
          },
          host: { id: "host_1", name: "Accessible host" },
          createdAt: 0,
          updatedAt: 1,
          lastReadAt: null,
          latestAttentionAt: 0,
        },
      ],
    };
    const app = await loadPluginApp(() => import("../../app"));
    const slot = renderSlot(
      app.threadPanelActions[0]!,
      { threadId: "thr_accessible", params: null },
      { rpc: fixture() },
    );
    await waitFor(() => expect(slot.getByRole("tabpanel")).toBeTruthy());
    expectTabRelationships(slot.container);
    await waitFor(() =>
      expect(
        slot.getByRole("img", { name: /Codex provider status: ready/i }),
      ).toBeTruthy(),
    );
    await waitFor(() =>
      expect(slot.getByText("Accessible execution task")).toBeTruthy(),
    );
    expect(slot.getByRole("heading", { name: "Queue" })).toBeTruthy();
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("tab", { name: "Changes" }));
    await waitFor(() =>
      expect(slot.getAllByText("main").length).toBeGreaterThan(0),
    );
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    await waitFor(() => expect(slot.getByText("gpt-5.6-terra")).toBeTruthy());
    expect(slot.getByText("bb/accessible-agent")).toBeTruthy();
    expect(slot.getByText("Accessible delegated task")).toBeTruthy();
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("fails closed for both axe violations and incomplete generic ARIA labels", async () => {
    const malformedMenu = document.createElement("div");
    const menu = document.createElement("span");
    menu.setAttribute("role", "menu");
    const groupControl = document.createElement("button");
    groupControl.textContent = "Custom group";
    menu.append(groupControl);
    malformedMenu.append(menu);
    document.body.append(malformedMenu);
    const malformedResults = await axe(malformedMenu);
    expect(malformedResults.violations.map(({ id }) => id)).toContain(
      "aria-required-children",
    );
    expect(malformedResults.incomplete).toEqual([]);
    await expect(expectNoAriaViolations(malformedMenu)).rejects.toThrow();
    malformedMenu.remove();

    const genericContainer = document.createElement("div");
    const executionTasks = document.createElement("div");
    executionTasks.setAttribute("aria-label", "Execution tasks");
    executionTasks.textContent = "Accessible execution task";
    genericContainer.append(executionTasks);
    document.body.append(genericContainer);
    const genericResults = await axe(genericContainer);
    expect(genericResults.violations).toEqual([]);
    expect(genericResults.incomplete.map(({ id }) => id)).toContain(
      "aria-prohibited-attr",
    );
    await expect(expectNoAriaViolations(genericContainer)).rejects.toThrow();
    genericContainer.remove();
  });
});
