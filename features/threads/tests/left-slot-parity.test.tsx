// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";
import { dispatchHrefClickWithoutJsdomNavigation } from "../../../tests/utils/dispatch-href-click";

const project = { id: "project", name: "Project", isPersonal: false };

function thread(
  id: string,
  title: string,
  parentThreadId: string | null = null,
  providerId = "codex",
): PluginSidebarThread {
  return {
    id,
    projectId: project.id,
    title,
    titleFallback: null,
    parentThreadId,
    sectionId: null,
    originKind: null,
    originPluginId: null,
    providerId,
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

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function provider(id: string, displayName: string, logoUrl: string | null) {
  return {
    id,
    pluginId: `provider-${id}`,
    displayName,
    available: true,
    logoUrl,
    capabilities: {
      modelCatalogScope: "host",
      permissionModes: ["accept-edits"],
      supportsFork: true,
      supportsNativeUserQuestion: false,
      supportsServiceTier: false,
      supportsSessionRewind: true,
      supportsThreadArchive: true,
      supportsThreadRename: true,
    },
    composerActions: [],
    maintenance: { health: true, installation: true, usage: true },
  };
}

async function leftSlot({
  threads = [thread("thr_one", "One"), thread("thr_two", "Two")],
  groups = [{ id: "group_later", name: "Later", threadIds: [] as string[] }],
  activeProjectId = null,
  sidebarPullRequests = {},
  providers = [],
  settings,
  rpc = {},
}: {
  threads?: ReturnType<typeof thread>[];
  groups?: { id: string; name: string; threadIds: string[] }[];
  activeProjectId?: string | null;
  sidebarPullRequests?: Record<
    string,
    {
      number: number;
      title: string;
      url: string;
      state: "closed" | "draft" | "merged" | "open";
      attention: "none";
    }
  >;
  providers?: unknown[];
  settings?: Record<string, string | boolean>;
  rpc?: Record<string, unknown>;
} = {}) {
  getPluginQueryClient().clear();
  const app = await loadPluginApp(() => import("../../../app"));
  const defaults = {
    sidebarTasks: () => ({
      available: true,
      tasks: [],
      projects: [],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getSidebarOrder: () => ({ threadIds: threads.map(({ id }) => id) }),
    getThreadGroups: () => ({ groups }),
    getSidebarAppearance: () => ({ rowHeight: 40 }),
    getRecycleBin: () => ({ entries: [] }),
    binSidebarThread: () => ({ entries: [] }),
    restoreBinnedSidebarThread: () => ({ destination: null, entries: [] }),
    saveThreadGroups: ({ groups: next }: { groups: unknown[] }) => ({
      groups: next,
    }),
    saveSiblingOrder: ({ threadIds }: { threadIds: string[] }) => ({
      threadIds,
    }),
    sidebarArchivedThreads: () => ({
      available: true,
      threads: [],
      error: null,
    }),
    sidebarAuthoredPullRequests: () => ({
      available: true,
      pullRequests: [],
      error: null,
    }),
    sidebarAuthoredPullRequestStacks: () => ({
      available: true,
      pullRequests: [],
      error: null,
    }),
    getGitHubApiHealth: () => ({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    }),
    ...rpc,
  };
  return renderSlot(
    app.threadLists[0]!,
    {
      activeThreadId: null,
      activeProjectId,
      isCompactViewport: false,
      onNavigate: vi.fn(),
      searchQuery: "",
      Original: () => <div>Native BB list</div>,
      experimental_Original: () => <div>Deprecated native BB list</div>,
    },
    {
      sidebarThreads: { status: "ready", projects: [project], threads },
      providers: { status: "ready", providers: providers as never },
      settings,
      sidebarPullRequests,
      rpc: defaults as never,
    },
  );
}

afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "elementFromPoint");
});

function mockElementAt(element: Element | null) {
  const elementAt = vi.fn(() => element);
  Object.defineProperty(document, "elementFromPoint", {
    configurable: true,
    value: elementAt,
  });
  return elementAt;
}

describe("R18 registered left sidebar parity", () => {
  it("applies the plugin-configured stale timeout to active goals", async () => {
    vi.useFakeTimers();
    const now = Date.UTC(2026, 7, 29, 3);
    vi.setSystemTime(now);
    try {
      const goal = thread("thr_goal", "Goal thread");
      Object.assign(goal, {
        indicator: "goal",
        indicatorLabel: "Goal active",
        activity: { ...goal.activity, goals: 1 },
        createdAt: now - 15 * 60_000,
        updatedAt: now - 15 * 60_000,
        latestAttentionAt: now - 15 * 60_000,
      });
      const slot = await leftSlot({
        threads: [goal],
        settings: { stuckThreadMinutes: "15" },
      });

      expect(
        slot.getByRole("img", {
          name: "Goal active; no agent update for 15 minutes",
        }),
      ).toBeTruthy();
      slot.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies persisted precise row heights across the permitted range", async () => {
    for (const rowHeight of [35, 40, 47.5, 60]) {
      const slot = await leftSlot({
        rpc: { getSidebarAppearance: () => ({ rowHeight }) },
      });
      await waitFor(() =>
        expect(
          slot.container
            .querySelector<HTMLElement>(".ws-list")
            ?.style.getPropertyValue("--ws-sidebar-row-height"),
        ).toBe(`${rowHeight}px`),
      );
      slot.unmount();
    }
  });

  it("applies the persisted provider-working animation to the left sidebar", async () => {
    const slot = await leftSlot({
      rpc: {
        getSidebarAppearance: () => ({
          rowHeight: 40,
          textScale: 1,
          workingProviderAnimation: "fast-spin",
        }),
      },
    });
    await waitFor(() =>
      expect(
        slot.container
          .querySelector(".ws-list")
          ?.getAttribute("data-working-provider-animation"),
      ).toBe("fast-spin"),
    );
    slot.unmount();
  });

  it("keeps creation before refresh and refresh rightmost on every left tab", async () => {
    const slot = await leftSlot({ activeProjectId: project.id });
    const actionLabels = () =>
      [
        ...slot.container.querySelectorAll(".ws-work-toolbar-actions button"),
      ].map((button) => button.getAttribute("aria-label"));

    expect(actionLabels()).toEqual([
      "New thread in project",
      "Search threads",
      "Thread list settings",
      "Refresh threads",
    ]);
    expect(
      slot.getByRole("button", { name: "Refresh threads" }).classList,
    ).toContain("ws-refresh-button");

    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    expect(actionLabels()).toEqual([
      "Add task",
      "Search tasks",
      "Thread list settings",
      "Refresh tasks",
    ]);

    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    expect(actionLabels()).toEqual([
      "Search pull requests",
      "Thread list settings",
      "Refresh pull requests",
    ]);
    expect(
      slot.getByRole("button", { name: "Refresh pull requests" }).classList,
    ).toContain("ws-refresh-button");
  });

  it("keeps the left toolbar action layout stable while search opens", async () => {
    const slot = await leftSlot({ activeProjectId: project.id });
    const toolbar = slot.container.querySelector(
      ".ws-work-toolbar-actions",
    )!;
    const actionChildrenBefore = [...toolbar.children].map(
      (child) => child.className,
    );
    const searchTrigger = slot.getByRole("button", {
      name: "Search threads",
    });

    expect(searchTrigger.querySelector('[data-icon="Search"] path')).toBeTruthy();
    fireEvent.click(searchTrigger);

    expect(
      [...toolbar.children].map((child) => child.className),
    ).toEqual(actionChildrenBefore);
    expect(toolbar.querySelector(".ws-sidebar-search")).toBeTruthy();
    expect(
      slot.getByRole("searchbox", { name: "Search threads" })
        .closest("[data-portalled=true]")
        ?.parentElement,
    ).toBe(document.body);
    expect(searchTrigger.getAttribute("aria-expanded")).toBe("true");
  });

  it("searches each left tab and includes custom and archived thread groups", async () => {
    const slot = await leftSlot({
      threads: [
        thread("thr_active", "Active alpha"),
        thread("thr_later", "Custom beta"),
      ],
      groups: [
        {
          id: "group_later",
          name: "Later",
          threadIds: ["thr_later"],
        },
      ],
      rpc: {
        sidebarArchivedThreads: () => ({
          available: true,
          threads: [
            {
              id: "thr_archived",
              projectId: project.id,
              title: "Archived gamma",
              titleFallback: null,
              parentThreadId: null,
              providerId: "codex",
              environmentBranchName: "archive/gamma",
              environmentName: "gamma worktree",
              environmentWorkspaceDisplayKind: "managed-worktree",
              isPinned: false,
              isUnread: false,
              createdAt: 1,
              updatedAt: 2,
              archivedAt: 3,
            },
          ],
          error: null,
        }),
        sidebarTasks: () => ({
          available: true,
          tasks: [
            {
              id: "task_search",
              projectId: "tasks_project",
              projectName: "Sidebar",
              key: "BBPLUG-404",
              title: "Searchable task delta",
              status: "todo",
              priority: "medium",
              dueDate: null,
              parentTaskId: null,
              linkedThreadIds: [],
              assignee: "agent",
              position: 1024,
            },
            {
              id: "task_other",
              projectId: "tasks_project",
              projectName: "Sidebar",
              key: "BBPLUG-405",
              title: "Unrelated task",
              status: "todo",
              priority: "medium",
              dueDate: null,
              parentTaskId: null,
              linkedThreadIds: [],
              assignee: "agent",
              position: 2048,
            },
          ],
          projects: [{ id: "tasks_project", name: "Sidebar" }],
          error: null,
        }),
        sidebarAuthoredPullRequests: () => ({
          available: true,
          pullRequests: [
            {
              number: 456,
              title: "Searchable pull request epsilon",
              url: "https://github.com/acme/repo/pull/456",
              repository: "acme/repo",
              state: "open",
              draft: false,
              head: "feature/epsilon",
              base: "main",
              checks: "passing",
              review: "approved",
              requestedReviewers: [],
              reviewCommentCount: 0,
              stack: null,
            },
            {
              number: 457,
              title: "Unrelated pull request",
              url: "https://github.com/acme/repo/pull/457",
              repository: "acme/repo",
              state: "open",
              draft: false,
              head: "feature/other",
              base: "main",
              checks: "passing",
              review: "approved",
              requestedReviewers: [],
              reviewCommentCount: 0,
              stack: null,
            },
          ],
          error: null,
        }),
        sidebarAuthoredPullRequestStacks: () => new Promise(() => undefined),
      },
    });

    const threadSearchTrigger = slot.getByRole("button", {
      name: "Search threads",
    });
    expect(
      threadSearchTrigger.querySelector('[data-icon="Search"] path'),
    ).toBeTruthy();
    fireEvent.click(threadSearchTrigger);
    const threadSearch = slot.getByRole("searchbox", {
      name: "Search threads",
    });
    expect(threadSearchTrigger.getAttribute("aria-expanded")).toBe("true");
    const searchPopover = threadSearch.closest(".ws-sidebar-search-popover");
    expect(searchPopover?.getAttribute("data-portalled")).toBe("true");
    expect(searchPopover?.parentElement).toBe(document.body);
    expect(
      slot.container.querySelector(
        '.ws-work-toolbar-actions input[aria-label="Search threads"]',
      ),
    ).toBeNull();
    fireEvent.change(threadSearch, { target: { value: "beta" } });
    expect(slot.getByText("Custom beta")).toBeTruthy();
    expect(slot.queryByText("Active alpha")).toBeNull();

    fireEvent.change(threadSearch, { target: { value: "gamma" } });
    expect(await slot.findByText("Archived gamma")).toBeTruthy();
    expect(slot.getByRole("region", { name: "Archive threads" })).toBeTruthy();
    fireEvent.keyDown(threadSearch, { key: "Escape" });
    expect(
      slot.queryByRole("searchbox", { name: "Search threads" }),
    ).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    fireEvent.click(slot.getByRole("button", { name: "Search tasks" }));
    fireEvent.change(slot.getByRole("searchbox", { name: "Search tasks" }), {
      target: { value: "delta" },
    });
    expect(await slot.findByText("Searchable task delta")).toBeTruthy();
    expect(slot.queryByText("Unrelated task")).toBeNull();

    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    fireEvent.click(slot.getByRole("button", { name: "Search pull requests" }));
    fireEvent.change(
      slot.getByRole("searchbox", { name: "Search pull requests" }),
      { target: { value: "#456" } },
    );
    expect(
      await slot.findByRole("link", {
        name: /Searchable pull request epsilon/,
      }),
    ).toBeTruthy();
    expect(slot.queryByText("Unrelated pull request")).toBeNull();
  });

  it("keeps the PR refresh icon spinning while partial rows await stack enrichment", async () => {
    const stacks = deferred<{
      available: true;
      pullRequests: Array<{
        number: number;
        title: string;
        url: string;
        repository: string;
        state: "open";
        draft: false;
        head: string;
        base: string;
        checks: "passing";
        review: "approved";
        reviewCommentCount: number;
        stack: null;
      }>;
      error: null;
    }>();
    const pullRequests = [
      {
        number: 151,
        title: "Visible before Stack settles",
        url: "https://github.com/acme/repo/pull/151",
        repository: "acme/repo",
        state: "open" as const,
        draft: false as const,
        head: "feature/partial-stack",
        base: "main",
        checks: "passing" as const,
        review: "approved" as const,
        reviewCommentCount: 0,
        stack: null,
      },
    ];
    const slot = await leftSlot({
      rpc: {
        sidebarAuthoredPullRequests: () => ({
          available: true,
          pullRequests,
          error: null,
        }),
        sidebarAuthoredPullRequestStacks: () => stacks.promise,
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await slot.findByRole("link", {
      name: /Visible before Stack settles/,
    });
    const refresh = slot.getByRole("button", {
      name: "Refresh pull requests",
    });
    expect(refresh.getAttribute("aria-busy")).toBe("true");
    expect(
      refresh
        .querySelector('[data-icon="RefreshCw"]')
        ?.getAttribute("data-motion"),
    ).toBe("spin");

    stacks.resolve({ available: true, pullRequests, error: null });
    await waitFor(() => expect(refresh.getAttribute("aria-busy")).toBeNull());
    slot.unmount();
  });

  it("manages requested reviewers from both registered PR entrypoints", async () => {
    const updateReviewers = vi.fn(({ reviewers }: { reviewers: string[] }) => ({
      reviewers,
    }));
    const pullRequests = [
      {
        number: 153,
        title: "Manage requested reviewers",
        url: "https://github.com/acme/repo/pull/153",
        repository: "acme/repo",
        state: "open" as const,
        draft: false as const,
        head: "feature/reviewers",
        base: "main",
        checks: "passing" as const,
        review: "review_required" as const,
        requestedReviewers: ["alice"],
        reviewCommentCount: 0,
        stack: null,
      },
    ];
    const slot = await leftSlot({
      rpc: {
        sidebarAuthoredPullRequests: () => ({
          available: true,
          pullRequests,
          error: null,
        }),
        sidebarAuthoredPullRequestStacks: () => ({
          available: true,
          pullRequests,
          error: null,
        }),
        getPullRequestReviewers: () => ({
          available: true,
          reviewers: [
            { login: "alice", name: "Alice", avatarUrl: null },
            { login: "bob", name: "Bob", avatarUrl: null },
          ],
          error: null,
        }),
        updatePullRequestReviewers: updateReviewers,
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    const title = await slot.findByRole("link", {
      name: "Open pull request #153: Manage requested reviewers",
    });
    fireEvent.contextMenu(title);
    fireEvent.click(slot.getByRole("menuitem", { name: "Request reviewers…" }));
    expect(
      await slot.findByRole("combobox", { name: "Search reviewers" }),
    ).toBeTruthy();
    expect(slot.queryByRole("dialog")).toBeNull();
    fireEvent.click(await slot.findByRole("option", { name: /bob.*Bob/i }));
    await waitFor(() =>
      expect(updateReviewers).toHaveBeenCalledWith({
        repository: "acme/repo",
        number: 153,
        reviewers: ["alice", "bob"],
      }),
    );
    expect(
      slot
        .getByRole("button", { name: "Manage reviewers: Review: alice" })
        .querySelector(".ws-status")
        ?.getAttribute("data-tone"),
    ).toBe("warning");
    expect(
      slot.getByRole("combobox", { name: "Search reviewers" }),
    ).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Close" }));
    await waitFor(() =>
      expect(
        slot.queryByRole("combobox", { name: "Search reviewers" }),
      ).toBeNull(),
    );

    fireEvent.click(
      slot.getByRole("button", {
        name: "Manage reviewers: Review: alice",
      }),
    );
    expect(
      await slot.findByRole("combobox", { name: "Search reviewers" }),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("edits the shared row height from every left pane", async () => {
    let rowHeight = 40;
    const saveAppearance = vi.fn(
      ({ rowHeight: next }: { rowHeight: number }) => {
        rowHeight = next;
        return { rowHeight };
      },
    );
    const slot = await leftSlot({
      rpc: {
        getSidebarAppearance: () => ({ rowHeight }),
        saveSidebarAppearance: saveAppearance,
      },
    });

    for (const pane of ["Threads", "Tasks", "PRs"]) {
      fireEvent.click(slot.getByRole("button", { name: pane }));
      fireEvent.click(
        slot.getByRole("button", { name: "Thread list settings" }),
      );
      expect(slot.getByRole("spinbutton", { name: "Row height" })).toBeTruthy();
      fireEvent.keyDown(
        slot.getByRole("dialog", { name: "Thread list settings" }),
        { key: "Escape" },
      );
    }

    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    const input = slot.getByRole("spinbutton", {
      name: "Row height",
    }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "38.5" } });
    await waitFor(() =>
      expect(saveAppearance).toHaveBeenCalledWith({ rowHeight: 38.5 }),
    );
    await waitFor(() =>
      expect(
        slot.container
          .querySelector<HTMLElement>(".ws-list")
          ?.style.getPropertyValue("--ws-sidebar-row-height"),
      ).toBe("38.5px"),
    );
  });

  it("keeps task mappings in Tasks without duplicating badges on thread rows", async () => {
    const clipboardWrite = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const task = {
      id: "task_one",
      projectId: "task_project",
      projectName: "Work",
      key: "WORK-1",
      title: "Keep task mapping in Tasks",
      status: "in_progress" as const,
      priority: "medium" as const,
      dueDate: null,
      parentTaskId: null,
      position: 1024,
      linkedThreadIds: ["thr_one"],
      assignee: "agent" as const,
    };
    const slot = await leftSlot({
      providers: [provider("codex", "Codex", null)],
      rpc: {
        sidebarTasks: () => ({
          available: true,
          tasks: [task],
          projects: [{ id: "task_project", name: "Work" }],
          error: null,
        }),
        sidebarTaskLinks: () => ({
          available: true,
          links: {
            thr_one: [
              {
                task,
                threadId: "thr_one",
                liveStatus: "working",
                role: "execution",
                mode: "direct",
                idempotencyKey: null,
                dispatchState: "ready",
              },
            ],
          },
          error: null,
        }),
      },
    });

    await waitFor(() =>
      expect(slot.getByRole("link", { name: /One/ })).toBeTruthy(),
    );
    expect(slot.queryByText("WORK-1")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(slot.getByText("WORK-1")).toBeTruthy());
    expect(slot.getByText("Keep task mapping in Tasks")).toBeTruthy();
    expect(slot.queryByText("Bound direct execution task")).toBeNull();
    const owner = slot.getByRole("button", {
      name: "Copy assigned thread One",
    });
    expect(
      owner.querySelector('[role="img"][aria-label="Codex provider"]'),
    ).toBeTruthy();
    fireEvent.click(owner);
    await waitFor(() => expect(clipboardWrite).toHaveBeenCalledWith("One"));
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    slot.lifecycle.unmount();
  });

  it("shows host provider logos and an accessible fallback on thread rows", async () => {
    const fetchLogo = vi.fn(async (_url: string) => ({
      ok: true,
      status: 200,
      blob: async () => new Blob(["logo"], { type: "image/svg+xml" }),
    }));
    vi.stubGlobal("fetch", fetchLogo);
    const slot = await leftSlot({
      threads: [
        thread("thr_codex", "Codex thread"),
        thread("thr_claude", "Claude thread", null, "claude-code"),
        thread("thr_future", "Future thread", null, "future-agent"),
      ],
      providers: [
        provider("codex", "Codex", "/api/v1/system/providers/codex/logo"),
        provider(
          "claude-code",
          "Claude Code",
          "/api/v1/system/providers/claude-code/logo",
        ),
      ],
    });

    const codex = slot.getByRole("img", { name: "Codex provider" });
    const claude = slot.getByRole("img", { name: "Claude Code provider" });
    await waitFor(() =>
      expect(
        codex
          .querySelector<HTMLElement>(".ws-thread-provider-mark")
          ?.style.getPropertyValue("--ws-thread-provider-logo"),
      ).toMatch(/^url\("data:image\/svg\+xml/),
    );
    await waitFor(() =>
      expect(
        claude
          .querySelector<HTMLElement>(".ws-thread-provider-mark")
          ?.style.getPropertyValue("--ws-thread-provider-logo"),
      ).toMatch(/^url\("data:image\/svg\+xml/),
    );
    expect(codex.querySelector("img")).toBeNull();
    expect(claude.querySelector("img")).toBeNull();
    expect(fetchLogo).toHaveBeenCalledTimes(2);
    expect(fetchLogo.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/system/providers/codex/logo",
      "/api/v1/system/providers/claude-code/logo",
    ]);
    const fallback = slot.getByRole("img", {
      name: "future-agent provider",
    });
    expect(fallback.querySelector('[data-icon="Bot"]')).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows a compact stack-number badge only for threads returned by the stack projection", async () => {
    const directory = vi.fn(() => ({
      available: true,
      pullRequests: {
        thr_one: {
          number: 17,
          title: "Stacked pull request",
          url: "https://github.com/acme/repo/pull/17",
          state: "open",
          head: "feature/stacked",
          base: "main",
          checks: { failedCount: 0, passedCount: 1, pendingCount: 0, state: "passing", totalCount: 1 },
          review: { reviewRequestCount: 0, state: "approved" },
          attention: "ready_to_merge",
          mergeability: { mergeStateStatus: "CLEAN", mergeable: "MERGEABLE", state: "mergeable" },
          signal: { checks: "passing", review: "approved", reviewCommentCount: 0 },
          stackNumber: 17,
        },
        thr_two: null,
      },
      error: null,
    }));
    const slot = await leftSlot({
      rpc: { sidebarThreadPullRequests: directory },
    });

    await waitFor(() =>
      expect(slot.getByLabelText("Copy stack number #17").textContent).toBe(
        "#17",
      ),
    );
    expect(directory).toHaveBeenCalledWith({ threadIds: ["thr_one", "thr_two"] });
    expect(
      slot.getByRole("link", { name: /Two/ }).querySelector(".ws-stack-number"),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("keeps settings flow-safe and gives dialog dismissal the correct focus semantics", async () => {
    const slot = await leftSlot();
    const actions = slot.container.querySelector(".ws-work-toolbar-actions")!;
    expect(actions.tagName).toBe("DIV");
    expect(actions.closest("span")).toBeNull();
    const trigger = slot.getByRole("button", { name: "Thread list settings" });
    fireEvent.click(trigger);
    const dialog = slot.getByRole("dialog", { name: "Thread list settings" });
    await waitFor(() => expect(document.activeElement).toBe(dialog));
    fireEvent.keyDown(dialog, { key: "Escape" });
    await waitFor(() =>
      expect(
        slot.queryByRole("dialog", { name: "Thread list settings" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const external = document.createElement("button");
    external.textContent = "External control";
    document.body.append(external);
    external.focus();
    fireEvent.pointerDown(external);
    await waitFor(() =>
      expect(
        slot.queryByRole("dialog", { name: "Thread list settings" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(external);
    external.remove();
    slot.lifecycle.unmount();
  });

  it("marks a group when one of its threads needs attention", async () => {
    const actionable = thread("thr_attention", "Question");
    actionable.indicator = "waiting-for-input";
    const slot = await leftSlot({
      threads: [actionable],
      groups: [
        {
          id: "group_later",
          name: "Later",
          threadIds: [actionable.id],
        },
      ],
    });
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());

    const group = slot.getByText("Later").closest("summary")!;
    expect(
      within(group)
        .getByRole("img", { name: "Group needs attention" })
        .getAttribute("data-tone"),
    ).toBe("attention");
    expect(
      within(slot.container.querySelector(".ws-active-threads summary")!).queryByLabelText(
        "Group needs attention",
      ),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("uses the saved marker order for a group with multiple states", async () => {
    const working = thread("thr_working", "Working");
    working.indicator = "runtime";
    const completed = thread("thr_completed", "Completed");
    completed.indicator = "unread-success";
    const slot = await leftSlot({
      threads: [working, completed],
      groups: [
        {
          id: "group_later",
          name: "Later",
          threadIds: [working.id, completed.id],
        },
      ],
      rpc: {
        getSidebarAppearance: () => ({
          rowHeight: 40,
          groupActivityPriority: [
            "working",
            "completed",
            "attention",
            "error",
          ],
        }),
      },
    });
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    const group = slot.getByText("Later").closest("summary")!;
    expect(
      within(group)
        .getByRole("img", { name: "Group working" })
        .getAttribute("data-tone"),
    ).toBe("working");
    slot.lifecycle.unmount();
  });

  it("creates a custom group through the settings dialog without a browser prompt", async () => {
    const saveGroups = vi.fn(({ groups }: { groups: unknown[] }) => ({
      groups,
    }));
    const prompt = vi.spyOn(window, "prompt");
    const slot = await leftSlot({ rpc: { saveThreadGroups: saveGroups } });

    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    fireEvent.click(slot.getByRole("button", { name: "Add group" }));

    const name = slot.getByRole("textbox", { name: "Group name" });
    expect(document.activeElement).toBe(name);
    expect(slot.queryByRole("button", { name: "Create" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Cancel" })).toBeNull();
    fireEvent.change(name, { target: { value: "Soon" } });
    fireEvent.keyDown(name, { key: "Enter" });

    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith({
        activeGroupPosition: 0,
        groups: expect.arrayContaining([
          expect.objectContaining({ name: "Soon", threadIds: [] }),
        ]),
      }),
    );
    expect(prompt).not.toHaveBeenCalled();
    expect(slot.queryByRole("textbox", { name: "Group name" })).toBeNull();
    expect(
      slot.getByRole("dialog", { name: "Thread list settings" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Add group" }),
    );

    fireEvent.click(slot.getByRole("button", { name: "Add group" }));
    const cancelledName = slot.getByRole("textbox", { name: "Group name" });
    fireEvent.change(cancelledName, { target: { value: "Never saved" } });
    fireEvent.keyDown(cancelledName, { key: "Escape" });
    expect(slot.queryByRole("textbox", { name: "Group name" })).toBeNull();
    expect(
      slot.getByRole("dialog", { name: "Thread list settings" }),
    ).toBeTruthy();
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Add group" }),
    );
    slot.lifecycle.unmount();
  });

  it("reorders Active with custom groups by drag or keyboard and persists the rendered order", async () => {
    const saveGroups = vi.fn(({ groups: next }: { groups: unknown[] }) => ({
      groups: next,
    }));
    const slot = await leftSlot({
      threads: [thread("thr_one", "One"), thread("thr_two", "Two")],
      groups: [
        { id: "group_alpha", name: "Alpha", threadIds: ["thr_one"] },
        { id: "group_beta", name: "Beta", threadIds: ["thr_two"] },
        { id: "group_gamma", name: "Gamma", threadIds: [] },
      ],
      rpc: { saveThreadGroups: saveGroups },
    });

    await waitFor(() => expect(slot.getByText("Alpha")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    expect(slot.getByText("Groups")).toBeTruthy();
    expect(slot.queryByText("Group order")).toBeNull();
    expect(slot.queryByRole("button", { name: "Move Active up" })).toBeNull();

    const activeHandle = slot.getByRole("button", {
      name: "Drag Active to reorder",
    });
    expect(
      activeHandle.closest("[data-group-position]")?.querySelector(
        ".ws-thread-group-drag",
      ),
    ).toBe(activeHandle);
    const betaRow = slot
      .getByRole("button", { name: "Drag Beta to reorder" })
      .closest("[data-group-position]")!;
    vi.spyOn(betaRow, "getBoundingClientRect").mockReturnValue({
      top: 100,
      height: 40,
    } as DOMRect);
    const betaHandle = slot.getByRole("button", {
      name: "Drag Beta to reorder",
    });
    expect(betaRow.querySelector(".ws-thread-group-drag")).toBe(betaHandle);
    expect(betaRow.querySelector(".ws-thread-group-remove")).toBe(
      slot.getByRole("button", { name: "Remove Beta" }),
    );
    fireEvent.dragStart(activeHandle, {
      dataTransfer: { setData: vi.fn(), effectAllowed: "move" },
    });
    fireEvent.dragOver(betaRow, { clientY: 139 });
    expect(betaRow.getAttribute("data-drop-placement")).toBe("after");
    fireEvent.drop(betaRow);
    await waitFor(() =>
      expect(saveGroups).toHaveBeenLastCalledWith({
        groups: [
          { id: "group_alpha", name: "Alpha", threadIds: ["thr_one"] },
          { id: "group_beta", name: "Beta", threadIds: ["thr_two"] },
          { id: "group_gamma", name: "Gamma", threadIds: [] },
        ],
        activeGroupPosition: 2,
      }),
    );

    fireEvent.keyDown(
      slot.getByRole("button", { name: "Drag Gamma to reorder" }),
      { key: "ArrowUp" },
    );

    await waitFor(() =>
      expect(saveGroups).toHaveBeenLastCalledWith({
        groups: [
          { id: "group_alpha", name: "Alpha", threadIds: ["thr_one"] },
          { id: "group_beta", name: "Beta", threadIds: ["thr_two"] },
          { id: "group_gamma", name: "Gamma", threadIds: [] },
        ],
        activeGroupPosition: 3,
      }),
    );
    await waitFor(() => {
      const labels = [
        ...slot.container.querySelectorAll(
          ".ws-thread-statuses > details > summary",
        ),
      ].map((summary) => summary.textContent?.trim() ?? "");
      expect(
        labels.findIndex((label) => label.startsWith("Alpha")),
      ).toBeLessThan(labels.findIndex((label) => label.startsWith("Beta")));
      expect(
        labels.findIndex((label) => label.startsWith("Beta")),
      ).toBeLessThan(labels.findIndex((label) => label.startsWith("Gamma")));
      expect(
        labels.findIndex((label) => label.startsWith("Gamma")),
      ).toBeLessThan(labels.findIndex((label) => label.startsWith("Active")));
      expect(labels.at(-2)?.startsWith("Recycle Bin")).toBe(true);
      expect(labels.at(-1)?.startsWith("Archive")).toBe(true);
      for (const summary of slot.container.querySelectorAll(
        ".ws-thread-statuses > details > summary",
      )) {
        expect(
          summary.querySelector(":scope > .ws-thread-group-summary-label"),
        ).toBeTruthy();
        expect(
          summary.querySelector(":scope > .ws-thread-group-summary-meta"),
        ).toBeTruthy();
      }
    });
    slot.lifecycle.unmount();
  });

  it("dismisses group renaming on an outside press and anchors its rename hint", async () => {
    const slot = await leftSlot({
      threads: [thread("thr_alpha", "Alpha thread")],
      groups: [
        { id: "group_alpha", name: "Alpha", threadIds: ["thr_alpha"] },
      ],
    });

    await waitFor(() => expect(slot.getByText("Alpha")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    const trigger = slot.getByRole("button", { name: "Alpha" });
    const tooltipId = trigger.getAttribute("aria-describedby");
    expect(tooltipId).toBeTruthy();
    expect(
      document.getElementById(tooltipId!)?.getAttribute("data-tooltip-label"),
    ).toBe("Rename");
    expect(trigger.parentElement?.classList).toContain("ws-action-tooltip");

    fireEvent.click(trigger);
    expect(slot.getByRole("textbox", { name: "Rename Alpha" })).toBeTruthy();
    fireEvent.pointerDown(slot.getByText("Groups"));

    expect(slot.queryByRole("textbox", { name: "Rename Alpha" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        slot.getByRole("button", { name: "Alpha" }),
      ),
    );
    slot.lifecycle.unmount();
  });

  it("persists group disclosures without treating search expansion as a preference", async () => {
    let disclosures: Record<string, boolean> = {};
    const groups = [
      { id: "group_later", name: "Later", threadIds: ["thr_one"] },
    ];
    const saveGroups = vi.fn(
      ({
        groups: next,
        disclosures: nextDisclosures,
      }: {
        groups: typeof groups;
        disclosures?: Record<string, boolean>;
      }) => {
        disclosures = nextDisclosures ?? disclosures;
        return { groups: next, disclosures };
      },
    );
    const getThreadGroups = () => ({ groups, disclosures });
    const first = await leftSlot({
      groups,
      rpc: { getThreadGroups, saveThreadGroups: saveGroups },
    });

    const later = await first.findByText("Later");
    fireEvent.click(later);
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(
        expect.objectContaining({ disclosures: { group_later: false } }),
      ),
    );
    first.lifecycle.unmount();

    const restored = await leftSlot({
      groups,
      rpc: { getThreadGroups, saveThreadGroups: saveGroups },
    });
    await waitFor(() =>
      expect(
        restored.container
          .querySelector("details.ws-thread-group:not(.ws-active-threads)")
          ?.getAttribute("open"),
      ).toBeNull(),
    );
    restored.lifecycle.unmount();
  });

  it("keeps the Later default editable only while empty and exposes a dismissible settings dialog", async () => {
    const saveGroups = vi.fn(({ groups }: { groups: unknown[] }) => ({
      groups,
    }));
    const prompt = vi.spyOn(window, "prompt");
    const slot = await leftSlot({ rpc: { saveThreadGroups: saveGroups } });
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /One/ })).toBeTruthy(),
    );
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    const menu = slot.getByRole("dialog", { name: "Thread list settings" });
    expect(menu.classList.contains("ws-thread-settings-menu")).toBe(true);
    expect(slot.getByRole("button", { name: "Remove Later" }).hasAttribute("disabled")).toBe(
      false,
    );
    fireEvent.click(slot.getByRole("button", { name: "Add group" }));
    const groupName = slot.getByRole("textbox", { name: "Group name" });
    fireEvent.change(groupName, {
      target: { value: "Soon" },
    });
    fireEvent.keyDown(groupName, { key: "Enter" });
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.objectContaining({ name: "Soon", threadIds: [] }),
          ]),
        }),
      ),
    );
    fireEvent.click(slot.getByRole("button", { name: "Later" }));
    const renameInput = slot.getByRole("textbox", { name: "Rename Later" });
    expect(document.activeElement).toBe(renameInput);
    fireEvent.change(renameInput, { target: { value: "Later renamed" } });
    fireEvent.keyDown(renameInput, { key: "Enter" });
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: expect.arrayContaining([
            expect.objectContaining({ name: "Later renamed" }),
          ]),
        }),
      ),
    );
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Later renamed" }),
    );
    expect(prompt).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Remove Later renamed" }));
    await waitFor(() =>
      expect(saveGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({
          groups: expect.not.arrayContaining([
            expect.objectContaining({ name: "Later renamed" }),
          ]),
        }),
      ),
    );
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(
        slot.queryByRole("dialog", { name: "Thread list settings" }),
      ).toBeNull(),
    );
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Thread list settings" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(
        slot.queryByRole("dialog", { name: "Thread list settings" }),
      ).toBeNull(),
    );
    slot.lifecycle.unmount();
  });

  it("disables occupied group removal and keeps appearance editing inline", async () => {
    const slot = await leftSlot({
      threads: [
        thread("thr_one", "One"),
        thread("thr_child", "Child", "thr_one"),
        thread("thr_grouped", "Grouped"),
      ],
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_grouped"] },
      ],
    });
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    expect(slot.getByText("2 threads")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    expect(slot.getByRole("button", { name: "Remove Later" }).hasAttribute("disabled")).toBe(
      true,
    );
    expect(slot.getByRole("spinbutton", { name: "Row height" })).toBeTruthy();
    const appearance = slot.container.querySelector(
      ".ws-thread-appearance-settings",
    );
    const rowHeight = slot.getByRole("spinbutton", { name: "Row height" });
    const pluginSettings = slot.getByRole("link", {
      name: "Open Work Sidebar settings",
    });
    const textScale = slot.getByRole("spinbutton", { name: "Text scale" });
    expect(appearance?.contains(rowHeight)).toBe(true);
    expect(appearance?.contains(pluginSettings)).toBe(true);
    expect(
      appearance?.querySelectorAll('.ws-settings-row[data-layout="thread-popup"]'),
    ).toHaveLength(3);
    expect(appearance?.querySelectorAll("strong, b")).toHaveLength(0);
    expect(rowHeight.closest('.ws-settings-row[data-layout="thread-popup"]')).toBeTruthy();
    expect(textScale.closest('.ws-settings-row[data-layout="thread-popup"]')).toBeTruthy();
    expect(
      pluginSettings.classList.contains("ws-settings-row"),
    ).toBe(true);
    expect(
      slot.queryByText("Compact 0.90 · Default 1.00 · Comfortable 1.10"),
    ).toBeNull();
    expect(pluginSettings.getAttribute("href")).toBe(
      "/settings/plugins/work-sidebar",
    );
    expect(
      slot.queryByRole("link", { name: "Open sidebar list settings" }),
    ).toBeNull();
    const addGroup = slot.getByRole("button", { name: "Add group" });
    expect(addGroup.closest(".ws-thread-group-settings-header")).toBeTruthy();
    expect(slot.queryByRole("button", { name: "BB native list" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Enhanced list" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("uses the same whole-row drag gesture for custom groups and archived threads", async () => {
    const archivedAt = Date.now() - 3 * 3_600_000;
    const unarchive = vi.fn(({ threadId }: { threadId: string }) => ({
      threadId,
    }));
    const saveGroups = vi.fn(({ groups: next }: { groups: unknown[] }) => ({
      groups: next,
    }));
    const slot = await leftSlot({
      threads: [
        thread("thr_active", "Active thread"),
        thread("thr_grouped", "Grouped thread"),
      ],
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_grouped"] },
      ],
      providers: [
        provider("codex", "Codex", null),
        provider("claude-code", "Claude Code", null),
      ],
      rpc: {
        sidebarArchivedThreads: () => ({
          available: true,
          error: null,
          threads: [
            {
              id: "thr_archived",
              projectId: project.id,
              title: "Archived thread",
              titleFallback: null,
              parentThreadId: null,
              providerId: "codex",
              environmentBranchName: "feature/archive",
              environmentName: "Archive worktree",
              environmentWorkspaceDisplayKind: "managed-worktree",
              isPinned: false,
              isUnread: false,
              createdAt: 0,
              updatedAt: 0,
              archivedAt,
            },
            {
              id: "thr_archived_worktree",
              projectId: project.id,
              title: "Archived worktree thread",
              titleFallback: null,
              parentThreadId: null,
              providerId: "claude-code",
              environmentBranchName: null,
              environmentName: "Managed checkout",
              environmentWorkspaceDisplayKind: "managed-worktree",
              isPinned: false,
              isUnread: false,
              createdAt: 0,
              updatedAt: 0,
              archivedAt,
            },
          ],
        }),
        unarchiveSidebarThread: unarchive,
        saveThreadGroups: saveGroups,
      },
    });
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /Grouped thread/ })).toBeTruthy(),
    );
    const activeZone = slot.container.querySelector<HTMLElement>(
      '[data-ws-thread-drop-zone="active"]',
    )!;
    const groupedRow = await waitFor(() => {
      const row = slot.container.querySelector<HTMLElement>(
        '[data-ws-thread-group="group_later"][data-ws-thread-id="thr_grouped"]',
      );
      expect(row).toBeTruthy();
      return row!;
    });
    expect(groupedRow.dataset.wsThreadGroup).toBe("group_later");
    const elementAt = mockElementAt(activeZone);
    fireEvent.pointerDown(groupedRow, {
      button: 0,
      pointerId: 21,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 10, clientY: 20 });
    expect(activeZone.dataset.dropTarget).toBe("true");
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [{ id: "group_later", name: "Later", threadIds: [] }],
        }),
      ),
    );

    // An empty, collapsed custom-group header remains a real pointer target.
    // Its hover presentation must survive until pointer-up can persist the move.
    const laterGroup = slot.container.querySelector<HTMLElement>(
      '[data-ws-thread-drop-zone="group_later"]',
    )!;
    const activeRow = slot.container.querySelector<HTMLElement>(
      '[data-ws-thread-group="active"][data-ws-thread-id="thr_grouped"]',
    )!;
    elementAt.mockReturnValue(laterGroup.querySelector("summary"));
    fireEvent.pointerDown(activeRow, {
      button: 0,
      pointerId: 91,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 91, clientX: 10, clientY: 20 });
    expect(laterGroup.dataset.dropTarget).toBe("true");
    fireEvent.pointerUp(window, { pointerId: 91, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(saveGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({
          groups: [{ id: "group_later", name: "Later", threadIds: ["thr_grouped"] }],
        }),
      ),
    );

    // Native drag is a reliable fallback for the ordinary browser drag gesture.
    const nativeSource = slot.container.querySelector<HTMLElement>(
      '[data-ws-thread-group="group_later"][data-ws-thread-id="thr_grouped"]',
    )!;
    const transfer = {
      effectAllowed: "none",
      dropEffect: "none",
      setData: vi.fn(),
      getData: vi.fn(() => "thr_grouped"),
    };
    fireEvent.dragStart(nativeSource, { dataTransfer: transfer });
    expect(transfer.setData).toHaveBeenCalledWith("text/plain", "thr_grouped");
    fireEvent.dragOver(activeZone, { dataTransfer: transfer });
    expect(activeZone.dataset.dropTarget).toBe("true");
    fireEvent.drop(activeZone, { dataTransfer: transfer });
    fireEvent.dragEnd(nativeSource);
    await waitFor(() =>
      expect(saveGroups).toHaveBeenLastCalledWith(
        expect.objectContaining({
          groups: [{ id: "group_later", name: "Later", threadIds: [] }],
        }),
      ),
    );

    const archiveDisclosure =
      slot.container.querySelector<HTMLDetailsElement>(".ws-archived")!;
    expect(archiveDisclosure.open).toBe(false);
    await waitFor(() =>
      expect(
        archiveDisclosure.querySelector(
          "summary > .ws-thread-group-summary-meta > span",
        )?.textContent,
      ).toBe(
        "2",
      ),
    );
    fireEvent.click(archiveDisclosure.querySelector("summary")!);
    const archivedLink = await slot.findByRole("link", {
      name: /Archived thread/,
    });
    const duration = archivedLink.querySelector("time");
    expect(duration?.textContent).toBe("3h");
    expect(duration?.getAttribute("aria-label")).toBe("Archived 3h ago");
    expect(duration?.parentElement?.parentElement?.classList).toContain(
      "ws-thread-trailing",
    );
    expect(
      archivedLink.querySelector(
        '.ws-thread-leading .ws-thread-provider[data-provider-id="codex"]',
      ),
    ).toBeTruthy();
    expect(
      archivedLink.querySelector(
        '.ws-thread-provider[data-provider-id="codex"]',
      ),
    ).toBeTruthy();
    expect(archivedLink.querySelector(".ws-thread-location")?.textContent).toBe(
      "feature/archive",
    );
    expect(
      archivedLink
        .querySelector(".ws-thread-location svg")
        ?.getAttribute("data-icon"),
    ).toBe("GitBranch");
    expect(archivedLink.querySelector(".ws-thread-meta")?.textContent).toBe(
      "feature/archive",
    );
    const worktreeLink = slot.getByRole("link", {
      name: /Archived worktree thread/,
    });
    expect(
      worktreeLink.querySelector(
        '.ws-thread-provider[data-provider-id="claude-code"]',
      ),
    ).toBeTruthy();
    expect(worktreeLink.querySelector(".ws-thread-location")?.textContent).toBe(
      "Managed checkout",
    );
    expect(worktreeLink.querySelector(".ws-thread-meta")?.textContent).toBe(
      "Managed checkout",
    );
    expect(archivedLink.querySelector(".ws-thread-drag-handle")).toBeNull();
    fireEvent.keyDown(archivedLink, { key: "F10", shiftKey: true });
    expect(
      slot.getByRole("menuitem", { name: "Resume in new worktree" }),
    ).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    slot.lifecycle.unmount();
  });

  it("keeps authored stacks collapsed, preserves native PR navigation, and recovers draft mutations", async () => {
    const update = deferred<{ ok: boolean }>();
    const layers = [
      {
        number: 1,
        title: "Base",
        url: "https://github.com/acme/repo/pull/1",
        head: "feature/base",
        base: "main",
        draft: false,
        checks: "passing",
        review: "approved",
        reviewCommentCount: 2,
      },
      {
        number: 2,
        title: "Child",
        url: "https://github.com/acme/repo/pull/2",
        head: "feature/child",
        base: "feature/base",
        draft: false,
        checks: "pending",
        review: "review_requested",
        reviewCommentCount: 0,
      },
    ];
    const stack = {
      id: "stack",
      number: 17,
      currentPullRequest: 1,
      base: "main",
      pullRequests: layers,
    };
    const pullRequests = layers.map((layer) => ({
      ...layer,
      repository: "acme/repo",
      state: "open" as const,
      stack,
    }));
    const setDraft = vi
      .fn()
      .mockImplementationOnce(() => update.promise)
      .mockImplementationOnce(() => Promise.resolve({ ok: true }));
    const linkedThread = {
      ...thread("thr_child", "Child stack worker", null, "claude-code"),
      environment: {
        id: "env_child",
        name: "Child stack workspace",
        branchName: "feature/child",
        workspaceDisplayKind: "managed-worktree" as const,
      },
    };
    const slot = await leftSlot({
      threads: [linkedThread],
      providers: [provider("claude-code", "Claude", null)],
      rpc: {
        sidebarAuthoredPullRequests: () => ({
          available: true,
          pullRequests,
          error: null,
        }),
        sidebarAuthoredPullRequestStacks: () => ({
          available: true,
          pullRequests,
          error: null,
        }),
        getSidebarAppearance: () => ({
          rowHeight: 40,
          openPrLinksExternallyWithModifier: false,
        }),
        setAuthoredPullRequestDraft: setDraft,
      },
    });
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /Base/ })).toBeTruthy(),
    );
    expect(slot.getByLabelText("Copy stack number #17").textContent).toBe(
      "#17",
    );
    expect(
      slot.getByLabelText("Copy stack number #17").querySelector("svg"),
    ).toBeTruthy();
    expect(slot.queryByRole("link", { name: /Child/ })).toBeNull();
    const linkedProvider = slot.getByRole("button", {
      name: "Open linked thread Child stack worker",
    });
    expect(linkedProvider.closest("article")?.textContent).toContain("Base");
    fireEvent.click(linkedProvider);
    expect(slot.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_child",
      options: { split: false },
    });
    expect(slot.getByRole("img", { name: "Checks passing" })).toBeTruthy();
    expect(slot.getByRole("img", { name: /^Approved/ })).toBeTruthy();
    const baseLink = slot.getByRole("link", { name: /Base/ });
    expect(baseLink.getAttribute("href")).toBe(
      "https://github.com/acme/repo/pull/1",
    );
    expect(baseLink.hasAttribute("target")).toBe(false);
    for (const modifier of [{ ctrlKey: true }, { metaKey: true }]) {
      const modifiedClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        ...modifier,
      });
      expect(
        dispatchHrefClickWithoutJsdomNavigation(baseLink, modifiedClick),
      ).toBe(false);
    }
    expect(slot.inspection.navigateCalls).not.toContainEqual({
      method: "openUrl",
      url: "https://github.com/acme/repo/pull/1",
    });
    expect(dispatchHrefClickWithoutJsdomNavigation(baseLink)).toBe(false);
    expect(slot.inspection.navigateCalls).toContainEqual({
      method: "openUrl",
      url: "https://github.com/acme/repo/pull/1",
    });
    expect(baseLink.closest("article")?.hasAttribute("data-selected")).toBe(
      false,
    );
    expect(baseLink.hasAttribute("aria-current")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Expand stack layers" }));
    expect(slot.getByRole("link", { name: /Child/ })).toBeTruthy();
    expect(
      slot.getAllByRole("button", {
        name: "Open linked thread Child stack worker",
      }),
    ).toHaveLength(1);
    const basePrBadge = slot.getByRole("button", {
      name: "Copy PR number #1",
    });
    fireEvent.contextMenu(basePrBadge);
    fireEvent.click(slot.getByRole("menuitem", { name: "Mark draft" }));
    fireEvent.contextMenu(basePrBadge);
    await waitFor(() =>
      expect(
        slot
          .getByRole("menuitem", { name: "Updating…" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    update.reject(new Error("draft rejected"));
    await waitFor(() =>
      expect(
        slot
          .getByRole("menuitem", { name: "Mark draft" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    fireEvent.click(slot.getByRole("menuitem", { name: "Mark draft" }));
    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(2));
    fireEvent.contextMenu(basePrBadge);
    await waitFor(() =>
      expect(
        slot
          .getByRole("menuitem", { name: "Mark draft" })
          .hasAttribute("disabled"),
      ).toBe(false),
    );
    slot.lifecycle.unmount();
  });

  it("persists unified pointer ordering, moves across groups, hands archive drops to BB, and ignores rename inputs", async () => {
    const saveBefore = vi.fn(({ threadIds }: { threadIds: string[] }) => ({
      threadIds,
    }));
    const beforeGroup = await leftSlot({
      rpc: { saveSiblingOrder: saveBefore },
    });
    await waitFor(() =>
      expect(beforeGroup.getByRole("link", { name: /Two/ })).toBeTruthy(),
    );
    const beforeSource = beforeGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_two"]',
    )!;
    const beforeTarget = beforeGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    const elementAt = mockElementAt(beforeTarget);
    vi.spyOn(beforeTarget, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    fireEvent.pointerDown(beforeSource, {
      button: 0,
      pointerId: 6,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 6, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 6, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(saveBefore).toHaveBeenCalledWith({
        threadIds: ["thr_two", "thr_one"],
      }),
    );
    beforeGroup.lifecycle.unmount();

    const saveOrder = vi.fn(({ threadIds }: { threadIds: string[] }) => ({
      threadIds,
    }));
    const sameGroup = await leftSlot({ rpc: { saveSiblingOrder: saveOrder } });
    await waitFor(() =>
      expect(sameGroup.getByRole("link", { name: /One/ })).toBeTruthy(),
    );
    const source = sameGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    const target = sameGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_two"]',
    )!;
    elementAt.mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    fireEvent.pointerDown(source, {
      button: 0,
      pointerId: 7,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 80 });
    await waitFor(() =>
      expect(saveOrder).toHaveBeenCalledWith({
        threadIds: ["thr_two", "thr_one"],
      }),
    );
    fireEvent.contextMenu(sameGroup.getByRole("link", { name: /One/ }));
    fireEvent.click(await sameGroup.findByRole("menuitem", { name: "Rename" }));
    const renameInput = sameGroup.getByLabelText("Thread title");
    // The test host does not expose BB's splitProps callback; live review owns that host handoff.
    fireEvent.pointerDown(renameInput, {
      button: 0,
      pointerId: 8,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 10, clientY: 80 });
    expect(saveOrder).toHaveBeenCalledTimes(1);
    sameGroup.lifecycle.unmount();

    const saveGroups = vi.fn(({ groups: next }: { groups: unknown[] }) => ({
      groups: next,
    }));
    const binSidebarThread = vi.fn(() => ({ entries: [] }));
    const crossGroup = await leftSlot({
      groups: [{ id: "group_later", name: "Later", threadIds: ["thr_two"] }],
      rpc: { saveThreadGroups: saveGroups, binSidebarThread },
    });
    await waitFor(() => expect(crossGroup.getByText("Later")).toBeTruthy());
    const crossSource = crossGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    const crossTarget = crossGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_two"]',
    )!;
    elementAt.mockReturnValue(crossTarget);
    fireEvent.pointerDown(crossSource, {
      button: 0,
      pointerId: 9,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(
        expect.objectContaining({
          groups: [
            {
              id: "group_later",
              name: "Later",
              threadIds: ["thr_two", "thr_one"],
            },
          ],
        }),
      ),
    );
    const archiveSource = crossGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    const archive = crossGroup.container.querySelector<HTMLElement>(
      '[data-ws-thread-drop-zone="recycle-bin"]',
    )!;
    elementAt.mockReturnValue(archive);
    fireEvent.pointerDown(archiveSource, {
      button: 0,
      pointerId: 10,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(binSidebarThread).toHaveBeenCalledWith({
        threadId: "thr_one",
        originGroupId: "group_later",
      }),
    );
    crossGroup.lifecycle.unmount();
  });

  it("reparents through the existing hierarchy mutation, promotes through To Top, and leaves rejected hierarchy drops unchanged", async () => {
    const moveThread = vi.fn(
      (input: { threadId: string; parentThreadId: string | null }) => ({
        ...input,
        oldRootThreadId: "thr_one",
        newRootThreadId: input.parentThreadId ?? input.threadId,
        affectedThreadIds: [input.threadId],
      }),
    );
    const saveOrder = vi.fn(({ threadIds }: { threadIds: string[] }) => ({
      threadIds,
    }));
    const reparent = await leftSlot({
      rpc: { moveSidebarThread: moveThread, saveSiblingOrder: saveOrder },
    });
    await waitFor(() =>
      expect(reparent.getByRole("link", { name: /One/ })).toBeTruthy(),
    );
    const source = reparent.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    const elementAt = mockElementAt(null);
    fireEvent.pointerDown(source, {
      button: 0,
      pointerId: 31,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 10, clientY: 20 });
    const target = reparent.container.querySelector<HTMLElement>(
      '[data-ws-thread-reparent-target="thr_two"]',
    )!;
    elementAt.mockReturnValue(target);
    fireEvent.pointerMove(window, { pointerId: 31, clientX: 10, clientY: 20 });
    const targetRow = reparent.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_two"]',
    )!;
    expect(targetRow.getAttribute("data-reparent-target")).toBe("true");
    expect(targetRow.hasAttribute("data-drop-placement")).toBe(false);
    fireEvent.pointerUp(window, { pointerId: 31, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(moveThread).toHaveBeenCalledWith({
        threadId: "thr_one",
        parentThreadId: "thr_two",
      }),
    );
    expect(saveOrder).not.toHaveBeenCalled();
    reparent.unmount();

    const splitMove = vi.fn();
    const splitYield = await leftSlot({
      rpc: { moveSidebarThread: splitMove },
    });
    const splitSource = splitYield.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_one"]',
    )!;
    elementAt.mockReturnValue(null);
    fireEvent.pointerDown(splitSource, {
      button: 0,
      pointerId: 35,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 35, clientX: 300, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 35, clientX: 300, clientY: 20 });
    expect(splitMove).not.toHaveBeenCalled();
    splitYield.unmount();

    const promoteThread = vi.fn(
      (input: { threadId: string; parentThreadId: string | null }) => ({
        ...input,
        oldRootThreadId: "thr_parent",
        newRootThreadId: input.parentThreadId ?? input.threadId,
        affectedThreadIds: [input.threadId],
      }),
    );
    const promote = await leftSlot({
      threads: [
        thread("thr_parent", "Parent"),
        thread("thr_child", "Child", "thr_parent"),
      ],
      rpc: { moveSidebarThread: promoteThread },
    });
    fireEvent.click(
      promote.getByRole("button", { name: "1 child agent, collapsed" }),
    );
    const child = promote.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_child"]',
    )!;
    elementAt.mockReturnValue(null);
    fireEvent.pointerDown(child, {
      button: 0,
      pointerId: 32,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 10, clientY: 20 });
    const toTop = await promote.findByRole("note", { name: "To Top" });
    const descriptionId = toTop.getAttribute("aria-describedby");
    expect(descriptionId).toBeTruthy();
    expect(document.getElementById(descriptionId!)?.textContent).toBe(
      "Move this thread out of its parent and make it a top-level thread",
    );
    elementAt.mockReturnValue(toTop);
    fireEvent.pointerMove(window, { pointerId: 32, clientX: 10, clientY: 20 });
    expect(toTop.getAttribute("data-drop-target")).toBe("true");
    expect(promote.container.querySelector("[data-drop-placement]")).toBeNull();
    fireEvent.pointerUp(window, { pointerId: 32, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(promoteThread).toHaveBeenCalledWith({
        threadId: "thr_child",
        parentThreadId: null,
      }),
    );
    promote.unmount();

    const rejectedMove = vi.fn();
    const rejected = await leftSlot({
      threads: [
        thread("thr_parent", "Parent"),
        thread("thr_child", "Child", "thr_parent"),
      ],
      rpc: { moveSidebarThread: rejectedMove },
    });
    if (!rejected.container.querySelector('[data-ws-thread-id="thr_child"]'))
      fireEvent.click(rejected.getByRole("button", { name: /1 child agent/ }));
    const rejectedSource = rejected.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_parent"]',
    )!;
    const rejectedElementAt = mockElementAt(null);
    fireEvent.pointerDown(rejectedSource, {
      button: 0,
      pointerId: 33,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 33, clientX: 10, clientY: 20 });
    const descendantTarget = rejected.container.querySelector<HTMLElement>(
      '[data-ws-thread-reparent-target="thr_child"]',
    )!;
    rejectedElementAt.mockReturnValue(descendantTarget);
    fireEvent.pointerMove(window, { pointerId: 33, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 33, clientX: 10, clientY: 20 });
    await waitFor(() => expect(rejectedMove).not.toHaveBeenCalled());
    rejected.unmount();

    const unchangedMove = vi.fn();
    const unchanged = await leftSlot({
      threads: [
        thread("thr_parent", "Parent"),
        thread("thr_child", "Child", "thr_parent"),
      ],
      rpc: { moveSidebarThread: unchangedMove },
    });
    if (!unchanged.container.querySelector('[data-ws-thread-id="thr_child"]'))
      fireEvent.click(unchanged.getByRole("button", { name: /1 child agent/ }));
    const unchangedSource = unchanged.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_child"]',
    )!;
    const unchangedElementAt = mockElementAt(null);
    fireEvent.pointerDown(unchangedSource, {
      button: 0,
      pointerId: 34,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 34, clientX: 10, clientY: 20 });
    const currentParentTarget = unchanged.container.querySelector<HTMLElement>(
      '[data-ws-thread-reparent-target="thr_parent"]',
    )!;
    unchangedElementAt.mockReturnValue(currentParentTarget);
    fireEvent.pointerMove(window, { pointerId: 34, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 34, clientX: 10, clientY: 20 });
    await waitFor(() => expect(unchangedMove).not.toHaveBeenCalled());
    unchanged.unmount();
  });

  it("renders one To Top drop target for the whole thread tree", async () => {
    const slot = await leftSlot({
      threads: [
        thread("thr_active", "Active"),
        thread("thr_later", "Later"),
        thread("thr_archive", "Archive"),
      ],
      groups: [
        { id: "group_later", name: "Later", threadIds: ["thr_later"] },
        { id: "group_archive", name: "Archive", threadIds: ["thr_archive"] },
      ],
    });
    await waitFor(() =>
      expect(
        slot.container.querySelector('[data-ws-thread-id="thr_active"]'),
      ).toBeTruthy(),
    );
    const source = slot.container.querySelector<HTMLElement>(
      '[data-ws-thread-id="thr_active"]',
    )!;
    mockElementAt(null);
    fireEvent.pointerDown(source, {
      button: 0,
      pointerId: 36,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, { pointerId: 36, clientX: 10, clientY: 20 });

    expect(slot.getAllByRole("note", { name: "To Top" })).toHaveLength(1);
    fireEvent.pointerCancel(window, { pointerId: 36 });
    slot.unmount();
  });

  it("refreshes exactly the advertised thread, archive, subtext, and authored-PR domains", async () => {
    const getOrder = vi.fn(() => ({ threadIds: ["thr_one", "thr_two"] }));
    const getGroups = vi.fn(() => ({
      groups: [{ id: "group_later", name: "Later", threadIds: [] }],
    }));
    const getLinks = vi.fn(() => ({ available: true, links: {}, error: null }));
    const getArchive = vi.fn(() => ({
      available: true,
      threads: [],
      error: null,
    }));
    const authored = vi.fn((input: unknown) => ({
      available: true,
      pullRequests: [],
      error: null,
    }));
    const stacks = vi.fn(() => ({
      available: true,
      pullRequests: [],
      error: null,
    }));
    const slot = await leftSlot({
      rpc: {
        getSidebarOrder: getOrder,
        getThreadGroups: getGroups,
        sidebarTaskLinks: getLinks,
        sidebarArchivedThreads: getArchive,
        sidebarAuthoredPullRequests: authored,
        sidebarAuthoredPullRequestStacks: stacks,
      },
    });
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /One/ })).toBeTruthy(),
    );
    const archive =
      slot.container.querySelector<HTMLDetailsElement>(".ws-archived")!;
    fireEvent.click(archive.querySelector("summary")!);
    await waitFor(() => expect(getArchive).toHaveBeenCalledTimes(1));
    const beforeRefresh = slot.getByRole("link", { name: /One/ });
    const counts = {
      order: getOrder.mock.calls.length,
      groups: getGroups.mock.calls.length,
      links: getLinks.mock.calls.length,
      archive: getArchive.mock.calls.length,
    };
    fireEvent.click(slot.getByRole("button", { name: "Refresh threads" }));
    await waitFor(() => {
      expect(getOrder).toHaveBeenCalledTimes(counts.order + 1);
      expect(getGroups).toHaveBeenCalledTimes(counts.groups + 1);
      expect(getLinks).toHaveBeenCalledTimes(counts.links + 1);
      expect(getArchive).toHaveBeenCalledTimes(counts.archive + 1);
    });
    expect(slot.getByRole("link", { name: /One/ })).not.toBe(beforeRefresh);
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(authored).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(stacks).toHaveBeenCalledTimes(1));
    fireEvent.click(
      slot.getByRole("button", { name: "Refresh pull requests" }),
    );
    await waitFor(() => expect(authored).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(stacks).toHaveBeenCalledTimes(2));
    expect(authored.mock.calls[1]).toEqual([{ force: true }]);
    slot.lifecycle.unmount();
  });
});
