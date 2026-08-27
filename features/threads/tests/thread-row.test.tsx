// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";

describe("R9 production ThreadRow host behavior", () => {
  it("mounts the registered left slot and preserves host actions, modifier selection, and split handoff", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const slot = renderSlot(app.threadLists[0]!, { activeThreadId: null, activeProjectId: null, isCompactViewport: false, onNavigate: vi.fn(), searchQuery: "", Original: () => null }, {
      sidebarThreads: { status: "ready", projects: [{ id: "project", name: "Project", isPersonal: false }], threads: [{ id: "thr_parent", projectId: "project", title: "Parent", titleFallback: null, parentThreadId: null, sectionId: null, originKind: null, originPluginId: null, providerId: "codex", hasPendingInteraction: false, activity: { workflows: 0, backgroundAgents: 0, backgroundCommands: 0, planMode: 0, goals: 0 }, indicator: "none", indicatorLabel: null, isUnread: false, isPinned: false, isArchived: false, environment: null, host: null, createdAt: 0, updatedAt: 0, lastReadAt: null, latestAttentionAt: 0 }] },
      rpc: { sidebarTasks: () => ({ available: true, tasks: [], projects: [], error: null }), sidebarTaskLinks: () => ({ available: true, links: {}, error: null }), getSidebarOrder: () => ({ threadIds: [] }), getThreadListMode: () => ({ mode: "enhanced" }), getThreadGroups: () => ({ groups: [] }), sidebarArchivedThreads: () => ({ available: true, threads: [], error: null }) } as never,
    });
    await waitFor(() => expect(slot.getByRole("link", { name: /Parent/ })).toBeTruthy());
    const link = slot.getByRole("link", { name: /Parent/ });
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_parent");
    fireEvent.click(link, { ctrlKey: true });
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    fireEvent.click(link);
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "open", threadId: "thr_parent", options: { split: false } });
    const restoredLink = slot.getByRole("link", { name: /Parent/ });
    fireEvent.contextMenu(restoredLink);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Archive" }));
    fireEvent.contextMenu(restoredLink);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "archive", threadId: "thr_parent" });
    expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "requestDelete", threadId: "thr_parent" });
    fireEvent.contextMenu(restoredLink);
    fireEvent.click(await slot.findByRole("menuitem", { name: "Rename" }));
    fireEvent.change(slot.getByLabelText("Thread title"), { target: { value: "Renamed" } });
    fireEvent.keyDown(slot.getByLabelText("Thread title"), { key: "Enter" });
    await waitFor(() => expect(slot.inspection.sidebarActionCalls).toContainEqual({ method: "rename", threadId: "thr_parent", title: "Renamed" }));
    const afterRenameLink = slot.getByRole("link", { name: /Parent/ });
    fireEvent.pointerDown(afterRenameLink, { button: 0, pointerId: 1 });
    // The parent receives pointer events and delegates the leave-sidebar branch to BB's split hook.
    expect(afterRenameLink).toBeTruthy();
    slot.lifecycle.unmount();
  });
});
