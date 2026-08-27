// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";

const project = { id: "project", name: "Project", isPersonal: false };

function thread(id: string, title: string, parentThreadId: string | null = null): PluginSidebarThread {
  return {
    id, projectId: project.id, title, titleFallback: null, parentThreadId,
    sectionId: null, originKind: null, originPluginId: null, providerId: "codex",
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

async function leftSlot({
  threads = [thread("thr_one", "One"), thread("thr_two", "Two")],
  groups = [{ id: "group_later", name: "Later", threadIds: [] as string[] }],
  rpc = {},
}: {
  threads?: ReturnType<typeof thread>[];
  groups?: { id: string; name: string; threadIds: string[] }[];
  rpc?: Record<string, unknown>;
} = {}) {
  getPluginQueryClient().clear();
  const app = await loadPluginApp(() => import("../../../app"));
  const defaults = {
    sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
    getSidebarOrder: () => ({ threadIds: threads.map(({ id }) => id) }),
    getThreadListMode: () => ({ mode: "enhanced" }),
    getThreadGroups: () => ({ groups }),
    saveThreadGroups: ({ groups: next }: { groups: unknown[] }) => ({ groups: next }),
    saveSiblingOrder: ({ threadIds }: { threadIds: string[] }) => ({ threadIds }),
    saveThreadListMode: ({ mode }: { mode: "enhanced" | "native" }) => ({ mode }),
    sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }),
    sidebarAuthoredPullRequests: () => ({ available: true, pullRequests: [], error: null }),
    sidebarAuthoredPullRequestStacks: () => ({ available: true, pullRequests: [], error: null }),
    getGitHubApiHealth: () => ({ state: "available", scope: "unknown", message: null, retryAt: null }),
    ...rpc,
  };
  return renderSlot(
    app.threadLists[0]!,
    { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original: () => <div>Native BB list</div>, experimental_Original: () => <div>Deprecated native BB list</div> },
    { sidebarThreads: { status: "ready", projects: [project], threads }, rpc: defaults as never },
  );
}

afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.restoreAllMocks(); Reflect.deleteProperty(document, "elementFromPoint"); });

function mockElementAt(element: Element | null) {
  const elementAt = vi.fn(() => element);
  Object.defineProperty(document, "elementFromPoint", { configurable: true, value: elementAt });
  return elementAt;
}

describe("R18 registered left sidebar parity", () => {
  it("keeps the Later default editable only while empty and exposes a dismissible settings dialog", async () => {
    const saveGroups = vi.fn(({ groups }: { groups: unknown[] }) => ({ groups }));
    const prompt = vi.spyOn(window, "prompt").mockReturnValueOnce("Soon").mockReturnValueOnce("Later renamed");
    const slot = await leftSlot({ rpc: { saveThreadGroups: saveGroups } });
    await waitFor(() => expect(slot.getByRole("link", { name: /One/ })).toBeTruthy());
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    const menu = slot.getByRole("dialog", { name: "Thread list settings" });
    expect(menu.classList.contains("ws-thread-settings-menu")).toBe(true);
    expect(slot.getByLabelText("Remove Later").hasAttribute("disabled")).toBe(false);
    fireEvent.click(slot.getByRole("button", { name: "Add group" }));
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
    expect(document.activeElement).toBe(
      slot.getByRole("button", { name: "Thread list settings" }),
    );
    slot.lifecycle.unmount();
  });

  it("disables occupied group removal and switches between enhanced and native lists", async () => {
    const saveMode = vi.fn(({ mode }: { mode: "enhanced" | "native" }) => ({ mode }));
    const slot = await leftSlot({ groups: [{ id: "group_later", name: "Later", threadIds: ["thr_one"] }], rpc: { saveThreadListMode: saveMode } });
    await waitFor(() => expect(slot.getByText("Later")).toBeTruthy());
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    expect(slot.getByLabelText("Remove Later").hasAttribute("disabled")).toBe(true);
    fireEvent.click(slot.getByRole("button", { name: "BB native list" }));
    await waitFor(() => expect(saveMode).toHaveBeenCalledWith({ mode: "native" }));
    expect(slot.getByText("Native BB list")).toBeTruthy();
    fireEvent.click(slot.getByRole("button", { name: "Thread list settings" }));
    fireEvent.click(slot.getByRole("button", { name: "Enhanced list" }));
    await waitFor(() => expect(saveMode).toHaveBeenNthCalledWith(2, { mode: "enhanced" }));
    expect(slot.getByRole("link", { name: /One/ })).toBeTruthy();
    slot.lifecycle.unmount();
  });

  it("restores an archived thread with Enter or Space on its drag handle", async () => {
    const unarchive = vi.fn(({ threadId }: { threadId: string }) => ({ threadId }));
    const slot = await leftSlot({
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
            environmentBranchName: null,
            isPinned: false,
            isUnread: false,
            createdAt: 0,
            updatedAt: 0,
            archivedAt: 0,
          }],
        }),
        unarchiveSidebarThread: unarchive,
      },
    });
    fireEvent.click(slot.container.querySelector(".ws-archived summary")!);
    const restore = await slot.findByRole("button", { name: "Restore Archived thread" });
    fireEvent.keyDown(restore, { key: "Enter" });
    await waitFor(() =>
      expect(unarchive).toHaveBeenCalledWith({ threadId: "thr_archived" }),
    );
    fireEvent.keyDown(restore, { key: " " });
    await waitFor(() => expect(unarchive).toHaveBeenCalledTimes(2));
    slot.lifecycle.unmount();
  });

  it("keeps authored stacks collapsed, supports modifier selection, and preserves draft mutation busy/error recovery", async () => {
    const update = deferred<{ ok: boolean }>();
    const layers = [
      { number: 1, title: "Base", url: "https://github.com/acme/repo/pull/1", head: "feature/base", base: "main", draft: false, checks: "passing", review: "approved", reviewCommentCount: 2 },
      { number: 2, title: "Child", url: "https://github.com/acme/repo/pull/2", head: "feature/child", base: "feature/base", draft: false, checks: "pending", review: "review_requested", reviewCommentCount: 0 },
    ];
    const stack = { id: "stack", base: "main", pullRequests: layers };
    const pullRequests = layers.map((layer) => ({ ...layer, repository: "acme/repo", state: "open" as const, stack }));
    const setDraft = vi.fn().mockImplementationOnce(() => update.promise).mockImplementationOnce(() => Promise.resolve({ ok: true }));
    const slot = await leftSlot({ rpc: {
      sidebarAuthoredPullRequests: () => ({ available: true, pullRequests, error: null }),
      sidebarAuthoredPullRequestStacks: () => ({ available: true, pullRequests, error: null }),
      setAuthoredPullRequestDraft: setDraft,
    } });
    fireEvent.click(slot.getByRole("button", { name: "PRs" }));
    await waitFor(() => expect(slot.getByRole("link", { name: /Base/ })).toBeTruthy());
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
