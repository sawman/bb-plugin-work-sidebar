// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot, type PluginSdkTestFakes } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { getPluginQueryClient } from "../../../query-runtime";
import { sidebarThreadFixture } from "../../../tests/utils/sidebar-thread";
import { threadControlsHost, lifecycleCalls } from "../../../tests/utils/thread-controls-host";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

const threadId = "thr_restore";
function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: threadId, projectId: "project", archivedAt: null, deletedAt: null,
    status: "idle", canRestoreEnvironment: true,
    runtime: { displayStatus: "idle" }, environmentId: "env_destroyed",
    environment: { id: "env_destroyed", status: "destroyed" },
    ...overrides,
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function registeredList({
  get = vi.fn(async () => snapshot()),
  restore = vi.fn(async () => snapshot({ status: "starting", runtime: { displayStatus: "provisioning" } })),
  archived = false,
  nativeDisabled = false,
}: { get?: ReturnType<typeof vi.fn>; restore?: ReturnType<typeof vi.fn>; archived?: boolean; nativeDisabled?: boolean } = {}) {
  const app = await loadPluginApp(() => import("../../../app"));
  const archivedRow = {
    id: threadId, projectId: "project", parentThreadId: null, title: "Restore me",
    titleFallback: null, providerId: "codex", environmentBranchName: "feature/restore",
    environmentName: "Old worktree", environmentWorkspaceDisplayKind: "managed-worktree",
    isPinned: false, isUnread: false, createdAt: 0, updatedAt: 0, archivedAt: 1,
  };
  const onNavigate = vi.fn();
  const slot = renderSlot(app.threadLists[0]!, {
    activeThreadId: null, activeProjectId: null, isCompactViewport: false,
    onNavigate, searchQuery: "",
  }, {
    ...threadControlsHost,
    threadActions: (target) => threadControlsHost.threadActions(target).map((entry) => ({
      ...entry, action: { ...entry.action, disabled: nativeDisabled },
    })),
    sdk: { threads: { ...threadControlsHost.sdk.threads, get, restoreEnvironment: restore } } as PluginSdkTestFakes,
    sidebarThreads: {
      status: "ready", projects: [{ id: "project", name: "Project", isPersonal: false, href: "/projects/project", settingsHref: "/projects/project/settings" }],
      threads: archived ? [] : [sidebarThreadFixture({ id: threadId, title: "Restore me" })],
    },
    rpc: {
      getSidebarAppearance: () => ({ rowHeight: 40, textScale: 1 }),
      getSidebarOrder: () => ({ threadIds: [] }), getThreadGroups: () => ({ groups: [] }),
      getRecycleBin: () => ({ entries: [] }),
      sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }),
      sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
      sidebarArchivedThreads: () => ({ available: true, threads: archived ? [archivedRow] : [], error: null }),
    } as never,
  });
  if (archived) {
    const disclosure = slot.container.querySelector<HTMLDetailsElement>(".ws-archived")!;
    fireEvent.click(disclosure.querySelector("summary")!);
  }
  const openMenu = async () => {
    const anchor = await slot.findByRole("link", { name: /Restore me/ });
    fireEvent.keyDown(anchor, { key: "F10", shiftKey: true });
  };
  return { slot, get, restore, openMenu, onNavigate };
}

afterEach(() => { cleanup(); getPluginQueryClient().clear(); vi.clearAllMocks(); });

describe("native workspace restore at the registered sidebar boundary", () => {
  it("reads eligibility only on menu open, rechecks before restoring, and opens the original thread", async () => {
    const { slot, get, restore, openMenu, onNavigate } = await registeredList();
    expect(get).not.toHaveBeenCalled();
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(restore).toHaveBeenCalledExactlyOnceWith({ threadId }));
    expect(get).toHaveBeenCalledTimes(2);
    expect(get.mock.calls[0]?.[0]).toEqual(expect.objectContaining({ threadId, include: "environment", signal: expect.any(AbortSignal) }));
    await waitFor(() => expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId, options: { split: false } }));
    expect(slot.inspection.navigateCalls.some((call) => call.method === "toCompose")).toBe(false);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("offers the existing explicit replacement flow only for known unsupported destroyed workspaces", async () => {
    const { slot, restore, openMenu, onNavigate } = await registeredList({ get: vi.fn(async () => snapshot({ canRestoreEnvironment: false })) });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Resume in new worktree" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toCompose", options: { projectId: "project", focusPrompt: true } });
    expect(restore).not.toHaveBeenCalled();
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it("keeps archived navigation and native unarchive separate from restore", async () => {
    const { slot, get, restore, openMenu } = await registeredList({ archived: true });
    await openMenu();
    fireEvent.click(slot.getByRole("menuitem", { name: "Open original thread" }));
    expect(slot.inspection.navigateCalls).toContainEqual({ method: "toThread", threadId, options: { split: false } });
    expect(lifecycleCalls).toEqual([]);
    expect(get).not.toHaveBeenCalled();
    expect(restore).not.toHaveBeenCalled();
    await openMenu();
    fireEvent.click(slot.getByRole("menuitem", { name: "Unarchive" }));
    expect(lifecycleCalls).toEqual([{ method: "archive", threadId }]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("does not restore a stale archived reply; only a fresh unarchived reply enables restore", async () => {
    const get = vi.fn().mockResolvedValueOnce(snapshot({ archivedAt: 1, canRestoreEnvironment: false })).mockResolvedValue(snapshot());
    const { slot, restore, openMenu } = await registeredList({ get });
    await openMenu();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    expect(slot.queryByRole("menuitem", { name: "Restore workspace" })).toBeNull();
    expect(slot.queryByRole("menuitem", { name: "Resume in new worktree" })).toBeNull();
    fireEvent.keyDown(window, { key: "Escape" });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
  });

  it("surfaces failed eligibility as an error with read retry, never as unsupported", async () => {
    const get = vi.fn().mockRejectedValueOnce(new Error("Eligibility unavailable")).mockResolvedValue(snapshot());
    const { slot, restore, openMenu } = await registeredList({ get });
    await openMenu();
    const retry = await slot.findByRole("menuitem", { name: "Retry workspace check" });
    expect(get).toHaveBeenCalledTimes(1);
    expect(slot.queryByRole("menuitem", { name: "Resume in new worktree" })).toBeNull();
    fireEvent.click(retry);
    await openMenu();
    expect(await slot.findByRole("menuitem", { name: "Restore workspace" })).toBeTruthy();
    expect(restore).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("contains an ambiguous restore failure; explicit retry rechecks eligibility without composing", async () => {
    const restore = vi.fn().mockRejectedValueOnce(new Error("Connection lost")).mockResolvedValue(snapshot());
    const { slot, get, openMenu } = await registeredList({ restore });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connection lost"));
    expect(slot.inspection.navigateCalls).toEqual([]);
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(2));
    expect(get.mock.calls.length).toBeGreaterThanOrEqual(4);
    expect(slot.inspection.navigateCalls.some((call) => call.method === "toCompose")).toBe(false);
  });

  it("does not repeat an ambiguous restore once BB reports provisioning", async () => {
    const get = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot({ canRestoreEnvironment: false, status: "starting", runtime: { displayStatus: "provisioning" }, environment: { status: "provisioning" } }));
    const restore = vi.fn().mockRejectedValue(new Error("Connection lost"));
    const { slot, openMenu } = await registeredList({ get, restore });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Connection lost"));
    await openMenu();
    expect((await slot.findByRole("menuitem", { name: "Restoring workspace…" })).hasAttribute("disabled")).toBe(true);
    expect(restore).toHaveBeenCalledTimes(1);
    expect(slot.queryByRole("menuitem", { name: "Resume in new worktree" })).toBeNull();
  });

  it("blocks a stale eligible action when the fresh workspace is already ready", async () => {
    const get = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot({ canRestoreEnvironment: false, environment: { status: "ready" } }));
    const { slot, restore, openMenu } = await registeredList({ get });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(slot.inspection.navigateCalls.some((call) => call.method === "toThread")).toBe(true));
    expect(restore).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls.some((call) => call.method === "toCompose")).toBe(false);
  });

  it("disables duplicate restore while the SDK call is pending", async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    const restore = vi.fn(() => pending.promise);
    const { slot, openMenu } = await registeredList({ restore });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(restore).toHaveBeenCalledTimes(1));
    await openMenu();
    const busy = await slot.findByRole("menuitem", { name: "Restoring workspace…" });
    expect(busy.hasAttribute("disabled")).toBe(true);
    fireEvent.click(busy);
    expect(restore).toHaveBeenCalledTimes(1);
    await act(async () => pending.resolve(snapshot()));
  });

  it.each(["archived", "deleted", "busy", "wrong-scope", "wrong-project", "missing-environment", "missing-eligibility"])("does not act on a fresh %s reply", async (kind) => {
    const blocked = {
      archived: { archivedAt: 1 }, deleted: { deletedAt: 1 }, busy: { status: "active" },
      "wrong-scope": { id: "thr_elsewhere" }, "missing-environment": { environment: undefined },
      "wrong-project": { projectId: "other" }, "missing-eligibility": { canRestoreEnvironment: undefined },
    }[kind]!;
    const get = vi.fn().mockResolvedValueOnce(snapshot()).mockResolvedValue(snapshot(blocked));
    const { slot, restore, openMenu } = await registeredList({ get });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(restore).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it.each([
    { environment: { status: "ready" }, canRestoreEnvironment: false },
    { canRestoreEnvironment: undefined },
    { environment: undefined },
    { deletedAt: 1, canRestoreEnvironment: false },
    { status: "active", canRestoreEnvironment: false },
  ])("offers neither restore nor replacement for ready/unknown/deleted/busy state %#", async (reply) => {
    const { slot, get, restore, openMenu } = await registeredList({ get: vi.fn(async () => snapshot(reply)) });
    await openMenu();
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(slot.queryByRole("menuitem", { name: "Checking workspace…" })).toBeNull());
    expect(slot.queryByRole("menuitem", { name: "Restore workspace" })).toBeNull();
    expect(slot.queryByRole("menuitem", { name: "Resume in new worktree" })).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("preserves host-disabled Unarchive and Delete entries", async () => {
    const { slot, restore, openMenu } = await registeredList({ archived: true, nativeDisabled: true });
    await openMenu();
    for (const label of ["Unarchive", "Delete"]) {
      const control = slot.getByRole("menuitem", { name: label });
      expect(control.hasAttribute("disabled")).toBe(true);
      fireEvent.click(control);
    }
    expect(lifecycleCalls).toEqual([]);
    expect(restore).not.toHaveBeenCalled();
  });

  it("cancels a late eligibility read when the menu closes", async () => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    const { slot, get, restore, openMenu } = await registeredList({ get: vi.fn(() => pending.promise) });
    await openMenu();
    expect((await slot.findByRole("menuitem", { name: "Checking workspace…" })).hasAttribute("disabled")).toBe(true);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(get.mock.calls[0]?.[0].signal.aborted).toBe(true);
    await act(async () => pending.resolve(snapshot()));
    expect(slot.queryByRole("menuitem", { name: "Restore workspace" })).toBeNull();
    expect(restore).not.toHaveBeenCalled();
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it.each(["read", "restore"])("suppresses late %s effects after the owning row unmounts", async (phase) => {
    const pending = deferred<ReturnType<typeof snapshot>>();
    const get = vi.fn().mockResolvedValueOnce(snapshot()).mockImplementation(() => phase === "read" ? pending.promise : Promise.resolve(snapshot()));
    const restore = vi.fn(() => pending.promise);
    const { slot, openMenu } = await registeredList({ get, restore });
    await openMenu();
    fireEvent.click(await slot.findByRole("menuitem", { name: "Restore workspace" }));
    await waitFor(() => expect(phase === "read" ? get : restore).toHaveBeenCalledTimes(phase === "read" ? 2 : 1));
    slot.unmount();
    expect(get.mock.calls[1]?.[0].signal.aborted).toBe(true);
    await act(async () => pending.resolve(snapshot()));
    expect(restore).toHaveBeenCalledTimes(phase === "read" ? 0 : 1);
    expect(slot.inspection.navigateCalls).toEqual([]);
  });

  it("leaves native archive/delete and split entries delegated to the same host actions", async () => {
    const { slot, restore, openMenu } = await registeredList();
    await openMenu();
    fireEvent.click(slot.getByRole("menuitem", { name: "Archive" }));
    await openMenu();
    fireEvent.click(slot.getByRole("menuitem", { name: "Delete" }));
    expect(lifecycleCalls).toEqual([{ method: "archive", threadId }, { method: "requestDelete", threadId }]);
    expect(restore).not.toHaveBeenCalled();
    expect(slot.queryByRole("menuitem", { name: "Unarchive" })).toBeNull();
  });
});
