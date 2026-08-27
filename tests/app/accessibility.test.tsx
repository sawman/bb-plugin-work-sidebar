// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { configureAxe } from "vitest-axe";
import { toHaveNoViolations } from "vitest-axe/dist/matchers.js";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { getPluginQueryClient } from "../../query-runtime";

expect.extend({ toHaveNoViolations });

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
  const outcome = toHaveNoViolations(results);
  expect(outcome.pass, outcome.message()).toBe(true);
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
      threads: [],
    };
    const app = await loadPluginApp(() => import("../../app"));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: () => undefined,
        searchQuery: "",
        Original: () => <div>Threads</div>,
      },
      { rpc: fixture() },
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
});
