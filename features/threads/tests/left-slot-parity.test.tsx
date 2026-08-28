// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";

const project = { id: "project", name: "Project", isPersonal: false };

function thread(
  id: string,
  title: string,
  parentThreadId: string | null = null,
  providerId = "codex",
): PluginSidebarThread {
  return {
    id, projectId: project.id, title, titleFallback: null, parentThreadId,
    sectionId: null, originKind: null, originPluginId: null, providerId,
    hasPendingInteraction: false,
    activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 },
    indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false,
    isArchived: false, environment: null, host: null, createdAt: 0, updatedAt: 0,
    lastReadAt: null, latestAttentionAt: 0,
  } as PluginSidebarThread;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((next, fail) => { resolve = next; reject = fail; });
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
  sidebarPullRequests = {},
  providers = [],
  rpc = {},
}: {
  threads?: ReturnType<typeof thread>[];
  groups?: { id: string; name: string; threadIds: string[] }[];
  sidebarPullRequests?: Record<string, {
    number: number;
    title: string;
    url: string;
    state: "closed" | "draft" | "merged" | "open";
    attention: "none";
  }>;
  providers?: unknown[];
  rpc?: Record<string, unknown>;
} = {}) {
  getPluginQueryClient().clear();
  const app = await loadPluginApp(() => import("../../../app"));
  const defaults = {
    sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getSidebarOrder: () => ({ threadIds: threads.map(({ id }) => id) }),
    getThreadGroups: () => ({ groups }),
    saveThreadGroups: ({ groups: next }: { groups: unknown[] }) => ({ groups: next }),
    saveSiblingOrder: ({ threadIds }: { threadIds: string[] }) => ({ threadIds }),
    sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }),
    sidebarPullRequestStacks: () => ({
      available: true,
      stacks: {},
      mergeTargets: {},
      error: null,
    }),
    sidebarAuthoredPullRequests: () => ({ available: true, pullRequests: [], error: null }),
    sidebarAuthoredPullRequestStacks: () => ({ available: true, pullRequests: [], error: null }),
    getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
    ...rpc,
  };
  return renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original: () => <div>Native BB list</div>, experimental_Original: () => <div>Deprecated native BB list</div> },
    {
      sidebarThreads: { status: "ready", projects: [project], threads },
      providers: { status: "ready", providers: providers as never },
      sidebarPullRequests,
      rpc: defaults as never,
    },
  );
}

afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); Reflect.deleteProperty(document, "elementFromPoint"); });

function mockElementAt(element: Element | null) {
  const elementAt = vi.fn(() => element);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementAt });
  return elementAt;
}

describe("R18 registered left sidebar parity", () => {
  it("keeps task mappings in Tasks without duplicating badges on thread rows", async () => {
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

    await waitFor(() => expect(slot.getByRole("link", { name: /One/ })).toBeTruthy());
    expect(slot.queryByText("WORK-1")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Tasks" }));
    await waitFor(() => expect(slot.getByText("WORK-1")).toBeTruthy());
    expect(slot.getByText("Keep task mapping in Tasks")).toBeTruthy();
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
      expect(codex.querySelector("img")?.getAttribute("src")).toMatch(
        /^data:image\/svg\+xml/,
      ),
    );
    await waitFor(() =>
      expect(claude.querySelector("img")?.getAttribute("src")).toMatch(
        /^data:image\/svg\+xml/,
      ),
    );
    expect(fetchLogo).toHaveBeenCalledTimes(2);
    expect(fetchLogo.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/system/providers/codex/logo",
      "/api/v1/system/providers/claude-code/logo",
    ]);
    const codexImage = codex.querySelector("img")!;
    fireEvent.error(codexImage);
    expect(codexImage.hidden).toBe(true);
    expect(
      slot.getByRole("img", { name: "future-agent provider" }),
    ).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("shows a compact stack-number badge only for threads returned by the stack projection", async () => {
    const stacks = vi.fn(() => ({
      available: true,
      stacks: {
        thr_one: {
          id: "github-stack:thr_one:17",
          number: 17,
          base: "main",
          currentPullRequest: 42,
          pullRequests: [],
        },
      },
      mergeTargets: {},
      error: null,
    }));
    const slot = await leftSlot({
      sidebarPullRequests: {
        thr_one: {
          number: 42,
          title: "Stacked pull request",
          url: "https://github.com/acme/repo/pull/42",
          state: "open",
          attention: "none",
        },
      },
      rpc: { sidebarPullRequestStacks: stacks },
    });

    await waitFor(() =>
      expect(slot.getByLabelText("Copy stack number #17").textContent).toBe(
        "#17",
      ),
    );
    expect(stacks).toHaveBeenCalledWith({ threadIds: ["thr_one"] });
    expect(slot.getByRole("link", { name: /Two/ }).querySelector(".ws-stack-number")).toBeNull();
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
    await waitFor(() => expect(slot.queryByRole("dialog", { name: "Thread list settings" })).toBeNull());
    expect(document.activeElement).toBe(trigger);
    fireEvent.click(trigger);
    const external = document.createElement("button");
    external.textContent = "External control";
    document.body.append(external);
    external.focus();
    fireEvent.pointerDown(external);
    await waitFor(() => expect(slot.queryByRole("dialog", { name: "Thread list settings" })).toBeNull());
    expect(document.activeElement).toBe(external);
    external.remove();
    slot.lifecycle.unmount();
  });

  it("creates a custom group through the settings dialog without a browser prompt", async () => {
    const saveGroups = vi.fn(({ groups }: { groups: unknown[] }) => ({ groups }));
    const prompt = vi.spyOn(window, "prompt");
    const slot = await leftSlot({ rpc: { saveThreadGroups: saveGroups } });

    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    fireEvent.click(slot.getByRole("button", { name: "Add group" }));

    const name = slot.getByRole("textbox", { name: "Group name" });
    expect(document.activeElement).toBe(name);
    fireEvent.change(name, { target: { value: "Soon" } });
    fireEvent.click(slot.getByRole("button", { name: "Create" }));

    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith({
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
    slot.lifecycle.unmount();
  });

  it("keeps the Later default editable only while empty and exposes a dismissible settings dialog", async () => {
    const saveGroups = vi.fn(({ groups }: { groups: unknown[] }) => ({ groups }));
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("Later renamed");
    const slot = await leftSlot({ rpc: { saveThreadGroups: saveGroups } });
    await waitFor(() => expect(slot.getByRole("link", { name: /One/ })).toBeTruthy());
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    const menu = slot.getByRole("dialog", { name: "Thread list settings" });
    expect(menu.classList.contains("ws-thread-settings-menu")).toBe(true);
    expect(slot.getByLabelText("Remove Later").hasAttribute("disabled")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Add group" }));
    fireEvent.change(slot.getByRole("textbox", { name: "Group name" }), {
      target: { value: "Soon" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Create" }));
    await waitFor(() => expect(saveGroups).toHaveBeenCalledWith({ groups: expect.arrayContaining([expect.objectContaining({ name: "Soon", threadIds: [] })]) }));
    fireEvent.click(slot.getByTitle("Rename Later"));
    await waitFor(() => expect(saveGroups).toHaveBeenCalledWith({ groups: expect.arrayContaining([expect.objectContaining({ name: "Later renamed" })]) }));
    fireEvent.click(slot.getByLabelText("Remove Later renamed"));
    await waitFor(() => expect(saveGroups).toHaveBeenLastCalledWith({ groups: expect.not.arrayContaining([expect.objectContaining({ name: "Later renamed" })]) }));
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(slot.queryByRole("dialog", { name: "Thread list settings" })).toBeNull(),
    );
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Thread list settings" }),
    );
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    fireEvent.pointerDown(document.body);
    await waitFor(() =>
      expect(slot.queryByRole("dialog", { name: "Thread list settings" })).toBeNull(),
    );
    slot.lifecycle.unmount();
  });

  it("disables occupied group removal and links to the plugin setting that owns list mode", async () => {
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
    expect(slot.getByText("2 threads · 1 subthread")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    expect(slot.getByLabelText("Remove Later").hasAttribute("disabled")).toBe(true);
    const settingsLink = slot.getByRole("link", {
      name: "Open Work Sidebar settings",
    });
    expect(settingsLink.getAttribute("href")).toBe(
      "/settings/plugins/work-sidebar",
    );
    expect(
      slot
        .getByRole("link", { name: "Open sidebar list settings" })
        .getAttribute("href"),
    ).toBe("/settings/appearance");
    expect(slot.queryByRole("button", { name: "BB native list" })).toBeNull();
    expect(slot.queryByRole("button", { name: "Enhanced list" })).toBeNull();
    slot.lifecycle.unmount();
  });

  it("uses the same whole-row drag gesture for custom groups and archived threads", async () => {
    const archivedAt = Date.now() - 3 * 3_600_000;
    const unarchive = vi.fn(({ threadId }: { threadId: string }) => ({ threadId }));
    const saveGroups = vi.fn(({ groups: next }: { groups: unknown[] }) => ({ groups: next }));
    const slot = await leftSlot({
      threads: [thread("thr_active", "Active thread"), thread("thr_grouped", "Grouped thread")],
      groups: [{ id: "group_later", name: "Later", threadIds: ["thr_grouped"] }],
      providers: [provider("codex", "Codex", null), provider("claude-code", "Claude Code", null)],
      rpc: {
        sidebarArchivedThreads: () => ({
          available: true,
          error: null,
          threads: [{
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
          }, {
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
          }],
        }),
        unarchiveSidebarThread: unarchive,
        saveThreadGroups: saveGroups,
      },
    });
    await waitFor(() => expect(slot.getByRole("link", { name: /Grouped thread/ })).toBeTruthy());
    const activeZone = slot.container.querySelector<HTMLElement>('[data-ws-thread-drop-zone="active"]')!;
    const groupedRow = await waitFor(() => {
      const row = slot.container.querySelector<HTMLElement>('[data-ws-thread-group="group_later"][data-ws-thread-id="thr_grouped"]');
      expect(row).toBeTruthy();
      return row!;
    });
    expect(groupedRow.dataset.wsThreadGroup).toBe("group_later");
    const elementAt = mockElementAt(activeZone);
    fireEvent.pointerDown(groupedRow, { button: 0, pointerId: 21, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 21, clientX: 10, clientY: 20 });
    expect(activeZone.dataset.dropTarget).toBe("true");
    fireEvent.pointerUp(window, { pointerId: 21, clientX: 10, clientY: 20 });
    await waitFor(() => expect(saveGroups).toHaveBeenCalledWith({
      groups: [{ id: "group_later", name: "Later", threadIds: [] }],
    }));

    fireEvent.click(slot.container.querySelector(".ws-archived summary")!);
    const archivedLink = await slot.findByRole("link", { name: /Archived thread/ });
    const duration = archivedLink.querySelector("time");
    expect(duration?.textContent).toBe("3h");
    expect(duration?.getAttribute("aria-label")).toBe("Archived 3h ago");
    expect(duration?.parentElement?.classList).toContain("ws-thread-trailing");
    expect(archivedLink.querySelector(".ws-thread-leading .ws-thread-agent-placeholder")).toBeTruthy();
    expect(archivedLink.querySelector('.ws-thread-provider[data-provider-id="codex"]')).toBeTruthy();
    expect(archivedLink.querySelector(".ws-thread-worktree")?.textContent).toBe("feature/archive");
    expect(archivedLink.querySelector(".ws-thread-worktree svg")).toBeNull();
    expect(archivedLink.querySelector(".ws-thread-meta")?.textContent).toBe("feature/archive");
    const worktreeLink = slot.getByRole("link", { name: /Archived worktree thread/ });
    expect(worktreeLink.querySelector('.ws-thread-provider[data-provider-id="claude-code"]')).toBeTruthy();
    expect(worktreeLink.querySelector(".ws-thread-worktree")?.textContent).toBe("Managed checkout");
    expect(worktreeLink.querySelector(".ws-thread-meta")?.textContent).toBe("Managed checkout");
    expect(archivedLink.querySelector(".ws-thread-drag-handle")).toBeNull();
    fireEvent.keyDown(archivedLink, { key: "F10", shiftKey: true });
    expect(slot.getByRole("menuitem", { name: "Active" })).toBeTruthy();
    expect(slot.getByRole("menuitem", { name: "Later" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    const archivedRow = archivedLink.closest<HTMLElement>(".ws-thread")!;
    const activeRow = slot.container.querySelector<HTMLElement>('[data-ws-thread-group="active"][data-ws-thread-id="thr_active"]')!;
    elementAt.mockReturnValue(archivedRow);
    fireEvent.pointerDown(activeRow, { button: 0, pointerId: 23, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 23, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 23, clientX: 10, clientY: 20 });
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "thr_active" });
    const groupZone = slot.container.querySelector<HTMLElement>('[data-ws-thread-drop-zone="group_later"]')!;
    elementAt.mockReturnValue(groupZone);
    fireEvent.pointerDown(archivedRow, { button: 0, pointerId: 22, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 22, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 22, clientX: 10, clientY: 20 });
    await waitFor(() =>
      expect(unarchive).toHaveBeenCalledWith({ threadId: "thr_archived" }),
    );
    await waitFor(() => expect(saveGroups).toHaveBeenLastCalledWith({
      groups: [{ id: "group_later", name: "Later", threadIds: ["thr_archived"] }],
    }));
    slot.lifecycle.unmount();
  });

  it("keeps authored stacks collapsed, supports modifier selection, and preserves draft mutation busy/error recovery", async () => {
    const update = deferred<{ ok: boolean }>();
    const layers = [
      { number: 1, title: "Base", url: "https://github.com/acme/repo/pull/1", head: "feature/base", base: "main", draft: false, checks: "passing", review: "approved", reviewCommentCount: 2 },
      { number: 2, title: "Child", url: "https://github.com/acme/repo/pull/2", head: "feature/child", base: "feature/base", draft: false, checks: "pending", review: "review_requested", reviewCommentCount: 0 },
    ];
    const stack = { id: "stack", number: 17, currentPullRequest: 1, base: "main", pullRequests: layers };
    const pullRequests = layers.map((layer) => ({ ...layer, repository: "acme/repo", state: "open" as const, stack }));
    const setDraft = vi.fn().mockImplementationOnce(() => update.promise).mockImplementationOnce(() => Promise.resolve({ ok: true }));
    const slot = await leftSlot({ rpc: {
      sidebarAuthoredPullRequests: () => ({ available: true, pullRequests, error: null }),
      sidebarAuthoredPullRequestStacks: () => ({ available: true, pullRequests, error: null }),
      setAuthoredPullRequestDraft: setDraft,
    } });
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(slot.getByRole("link", { name: /Base/ })).toBeTruthy());
    expect(slot.getByLabelText("Copy stack number #17").textContent).toBe(
      "#17",
    );
    expect(
      slot.getByLabelText("Copy stack number #17").querySelector("svg"),
    ).toBeTruthy();
    expect(slot.queryByRole("link", { name: /Child/ })).toBeNull();
    expect(slot.getByTitle("Checks passing")).toBeTruthy();
    expect(slot.getByTitle("Approved")).toBeTruthy();
    fireEvent.click(slot.getByRole("link", { name: /Base/ }), { ctrlKey: true });
    const selectedRow = slot.getByRole("link", { name: /Base/ }).closest("article")!;
    expect(selectedRow.getAttribute("data-selected")).toBe("true");
    expect(selectedRow.hasAttribute("aria-selected")).toBe(false);
    expect(slot.getByRole("link", { name: /Base/ }).getAttribute("aria-current")).toBe("true");
    fireEvent.click(slot.getByRole("button", { name: "Expand stack layers" }));
    expect(slot.getByRole("link", { name: /Child/ })).toBeTruthy();
    fireEvent.click(slot.getAllByRole("button", { name: "Mark draft" })[0]!);
    await waitFor(() => expect(slot.getByRole("button", { name: "Updating pull request state" }).hasAttribute("disabled")).toBe(true));
    update.reject(new Error("draft rejected"));
    await waitFor(() => expect(slot.getAllByRole("button", { name: "Mark draft" })[0]!.hasAttribute("disabled")).toBe(false));
    fireEvent.click(slot.getAllByRole("button", { name: "Mark draft" })[0]!);
    await waitFor(() => expect(setDraft).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(slot.getAllByRole("button", { name: "Mark draft" })[0]!.hasAttribute("disabled")).toBe(false));
    slot.lifecycle.unmount();
  });

  it("persists unified pointer ordering, moves across groups, hands archive drops to BB, and ignores rename inputs", async () => {
    const saveBefore = vi.fn(({ threadIds }: { threadIds: string[] }) => ({ threadIds }));
    const beforeGroup = await leftSlot({ rpc: { saveSiblingOrder: saveBefore } });
    await waitFor(() => expect(beforeGroup.getByRole("link", { name: /Two/ })).toBeTruthy());
    const beforeSource = beforeGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_two"]')!;
    const beforeTarget = beforeGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_one"]')!;
    const elementAt = mockElementAt(beforeTarget);
    vi.spyOn(beforeTarget, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
    fireEvent.pointerDown(beforeSource, { button: 0, pointerId: 6, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 6, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 6, clientX: 10, clientY: 20 });
    await waitFor(() => expect(saveBefore).toHaveBeenCalledWith({ threadIds: ["thr_two", "thr_one"] }));
    beforeGroup.lifecycle.unmount();

    const saveOrder = vi.fn(({ threadIds }: { threadIds: string[] }) => ({ threadIds }));
    const sameGroup = await leftSlot({ rpc: { saveSiblingOrder: saveOrder } });
    await waitFor(() => expect(sameGroup.getByRole("link", { name: /One/ })).toBeTruthy());
    const source = sameGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_one"]')!;
    const target = sameGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_two"]')!;
    elementAt.mockReturnValue(target);
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({ top: 0, height: 100 } as DOMRect);
    fireEvent.pointerDown(source, { button: 0, pointerId: 7, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 7, clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 7, clientX: 10, clientY: 80 });
    await waitFor(() => expect(saveOrder).toHaveBeenCalledWith({ threadIds: ["thr_two", "thr_one"] }));
    fireEvent.contextMenu(sameGroup.getByRole("link", { name: /One/ }));
    fireEvent.click(await sameGroup.findByRole("menuitem", { name: "Rename" }));
    const renameInput = sameGroup.getByLabelText("Thread title");
    // The test host does not expose BB's splitProps callback; live review owns that host handoff.
    fireEvent.pointerDown(renameInput, { button: 0, pointerId: 8, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 8, clientX: 10, clientY: 80 });
    fireEvent.pointerUp(window, { pointerId: 8, clientX: 10, clientY: 80 });
    expect(saveOrder).toHaveBeenCalledTimes(1);
    sameGroup.lifecycle.unmount();

    const saveGroups = vi.fn(({ groups: next }: { groups: unknown[] }) => ({ groups: next }));
    const crossGroup = await leftSlot({
      groups: [{ id: "group_later", name: "Later", threadIds: ["thr_two"] }],
      rpc: { saveThreadGroups: saveGroups },
    });
    await waitFor(() => expect(crossGroup.getByText("Later")).toBeTruthy());
    const crossSource = crossGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_one"]')!;
    const crossTarget = crossGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_two"]')!;
    elementAt.mockReturnValue(crossTarget);
    fireEvent.pointerDown(crossSource, { button: 0, pointerId: 9, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 9, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 9, clientX: 10, clientY: 20 });
    await waitFor(() => expect(saveGroups).toHaveBeenCalledWith({ groups: [{ id: "group_later", name: "Later", threadIds: ["thr_two", "thr_one"] }] }));
    const archiveSource = crossGroup.container.querySelector<HTMLElement>('[data-ws-thread-id="thr_one"]')!;
    const archive = crossGroup.container.querySelector<HTMLElement>('[data-ws-thread-drop-zone="archive"]')!;
    elementAt.mockReturnValue(archive);
    fireEvent.pointerDown(archiveSource, { button: 0, pointerId: 10, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 10, clientX: 10, clientY: 20 });
    fireEvent.pointerUp(window, { pointerId: 10, clientX: 10, clientY: 20 });
    expect(crossGroup.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "thr_one" });
    crossGroup.lifecycle.unmount();
  });

  it("refreshes exactly the advertised thread, archive, subtext, and authored-PR domains", async () => {
    const getOrder = vi.fn(() => ({ threadIds: ["thr_one", "thr_two"] }));
    const getGroups = vi.fn(() => ({ groups: [{ id: "group_later", name: "Later", threadIds: [] }] }));
    const getLinks = vi.fn(() => ({ available: true, links: {}, error: null }));
    const getArchive = vi.fn(() => ({ available: true, threads: [], error: null }));
    const authored = vi.fn((input: unknown) => ({ available: true, pullRequests: [], error: null }));
    const stacks = vi.fn(() => ({ available: true, pullRequests: [], error: null }));
    const slot = await leftSlot({ rpc: {
      getSidebarOrder: getOrder,
      getThreadGroups: getGroups,
      sidebarTaskLinks: getLinks,
      sidebarArchivedThreads: getArchive,
      sidebarAuthoredPullRequests: authored,
      sidebarAuthoredPullRequestStacks: stacks,
    } });
    await waitFor(() => expect(slot.getByRole("link", { name: /One/ })).toBeTruthy());
    const archive = slot.container.querySelector<HTMLDetailsElement>('[data-ws-thread-drop-zone="archive"]')!;
    fireEvent.click(archive.querySelector("summary")!);
    await waitFor(() => expect(getArchive).toHaveBeenCalledTimes(1));
    const beforeRefresh = slot.getByRole("link", { name: /One/ });
    const counts = { order: getOrder.mock.calls.length, groups: getGroups.mock.calls.length, links: getLinks.mock.calls.length, archive: getArchive.mock.calls.length };
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
    fireEvent.click(slot.getByRole("button", { name: "Refresh pull requests" }));
    await waitFor(() => expect(authored).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(stacks).toHaveBeenCalledTimes(2));
    expect(authored.mock.calls[1]).toEqual([{ force: true }]);
    slot.lifecycle.unmount();
  });
});
