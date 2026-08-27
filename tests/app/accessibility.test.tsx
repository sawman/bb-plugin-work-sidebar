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
    getThreadListMode: () => ({ mode: "enhanced" }),
    getThreadGroups: () => ({
      groups: [{ id: "group_later", name: "Later", threadIds: [] }],
    }),
    saveThreadGroups: ({ groups }: { groups: unknown[] }) => ({ groups }),
    saveSiblingOrder: ({ threadIds }: { threadIds: string[] }) => ({ threadIds }),
    saveThreadListMode: ({ mode }: { mode: "enhanced" | "native" }) => ({ mode }),
    sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }),
    sidebarTasks: () => ({
      available: true,
      tasks: [task],
      projects: [{ id: "project_1", name: "Project" }],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
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
    getWorkTracker: () => ({
      visible: false,
      available: false,
      message: null,
      suggestions: [],
      item: null,
      statusOptions: [],
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
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    await waitFor(() =>
      expect(slot.getByRole("dialog", { name: "Thread list settings" })).toBeTruthy(),
    );
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(slot.getByText("Accessible task")).toBeTruthy());
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(slot.getByText("Accessible PR")).toBeTruthy());
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("keeps representative Work, Changes, and Agents slot states ARIA-valid", async () => {
    host.sidebarThreads = { status: "ready", projects: [], threads: [] };
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
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("tab", { name: "Changes" }));
    await waitFor(() =>
      expect(slot.getAllByText("main").length).toBeGreaterThan(0),
    );
    await expectNoAriaViolations(slot.container);
    fireEvent.click(slot.getByRole("tab", { name: "Agents" }));
    await waitFor(() =>
      expect(slot.getByText(/No active delegated child threads/)).toBeTruthy(),
    );
    await expectNoAriaViolations(slot.container);
    slot.lifecycle.unmount();
  });

  it("fails closed for the exact missing-role and malformed-menu controls", async () => {
    const container = document.createElement("div");
    const provider = document.createElement("span");
    provider.setAttribute("aria-label", "Codex provider status: ready");
    const executionTasks = document.createElement("div");
    executionTasks.setAttribute("aria-label", "Execution tasks");
    const menu = document.createElement("span");
    menu.setAttribute("role", "menu");
    const groupControl = document.createElement("button");
    groupControl.textContent = "Custom group";
    menu.append(groupControl);
    container.append(provider, executionTasks, menu);
    document.body.append(container);
    await expect(expectNoAriaViolations(container)).rejects.toThrow();
    container.remove();
  });
});
