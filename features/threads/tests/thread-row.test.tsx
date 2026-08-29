// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { toast } from "sonner";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

describe("R9 production ThreadRow host behavior", () => {
  it("mounts the registered left slot and preserves host actions, modifier selection, and split handoff", async () => {
    const app = await loadPluginApp(() => import("../../../app"));
    const saveGroups = vi.fn((input: { groups: unknown[] }) => ({
      groups: input.groups,
    }));
    const moveThread = vi.fn((input: {
      threadId: string;
      parentThreadId: string | null;
    }) => ({
      ...input,
      oldRootThreadId: "thr_parent",
      newRootThreadId: input.parentThreadId ?? input.threadId,
      affectedThreadIds: [input.threadId],
    }));
    const slot = renderSlot(
      app.threadLists[0]!,
      {
        activeThreadId: null,
        activeProjectId: null,
        isCompactViewport: false,
        onNavigate: vi.fn(),
        searchQuery: "",
        Original: () => null,
      },
      {
        sidebarThreads: {
          status: "ready",
          projects: [{ id: "project", name: "Project", isPersonal: false }],
          threads: [
            {
              id: "thr_parent",
              projectId: "project",
              title: "Parent",
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
            {
              id: "thr_child",
              projectId: "project",
              title: "Child",
              titleFallback: null,
              parentThreadId: "thr_parent",
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
            {
              id: "thr_other",
              projectId: "project",
              title: "Other",
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
        },
        rpc: {
          sidebarTasks: () => ({
            available: true,
            tasks: [],
            projects: [],
            error: null,
          }),
          sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
          getSidebarOrder: () => ({ threadIds: [] }),
          getThreadGroups: () => ({
            groups: [{ id: "group_later", name: "Later", threadIds: [] }],
          }),
          saveThreadGroups: saveGroups,
          moveSidebarThread: moveThread,
          sidebarArchivedThreads: () => ({
            available: true,
            threads: [],
            error: null,
          }),
        } as never,
      },
    );
    await waitFor(() =>
      expect(slot.getByRole("link", { name: /Parent/ })).toBeTruthy(),
    );
    const link = slot.getByRole("link", { name: /Parent/ });
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_parent");
    fireEvent.click(link, { ctrlKey: true });
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
    fireEvent.click(link);
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_parent",
      options: { split: false },
    });
    const restoredLink = slot.getByRole("link", { name: /Parent/ });
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    fireEvent.click(
      await slot.findByRole("menuitem", { name: "Open in split" }),
    );
    // The harness observes the resulting sidebar action; it cannot inspect BB's pointer handoff.
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "open",
      threadId: "thr_parent",
      options: { split: true },
    });
    await waitFor(() =>
      expect(slot.queryByRole("menuitem", { name: "Rename" })).toBeNull(),
    );
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    const rename = await slot.findByRole("menuitem", { name: "Rename" });
    expect(rename.nextElementSibling?.tagName).toBe("HR");
    const moveUnder = slot.getByRole("menuitem", { name: "Move under…" });
    expect(moveUnder.previousElementSibling).toBe(rename.nextElementSibling);
    expect(moveUnder.nextElementSibling?.tagName).toBe("HR");
    expect(moveUnder.nextElementSibling?.nextElementSibling?.textContent).toBe(
      "Active",
    );
    fireEvent.click(moveUnder);
    const parentPicker = await slot.findByRole("combobox", {
      name: "New parent for Parent",
    });
    fireEvent.focus(parentPicker);
    expect(slot.queryByRole("option", { name: "Child" })).toBeNull();
    fireEvent.keyDown(parentPicker, { key: "Escape" });
    await waitFor(() =>
      expect(document.activeElement).toBe(
        slot.getByRole("link", { name: /Parent/ }),
      ),
    );
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Move under…" }));
    fireEvent.click(await slot.findByRole("option", { name: /^Other/ }));
    await waitFor(() =>
      expect(moveThread).toHaveBeenCalledWith({
        threadId: "thr_parent",
        parentThreadId: "thr_other",
      }),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "1 child agent, collapsed" }),
    );
    const childLink = await slot.findByRole("link", { name: /Child/ });
    fireEvent.contextMenu(childLink);
    const toTop = await slot.findByRole("menuitem", { name: "To Top" });
    expect(toTop.getAttribute("title")).toBe(
      "Move this thread out of its parent and make it a top-level thread",
    );
    expect(toTop.getAttribute("aria-describedby")).toBeNull();
    expect(slot.queryByRole("tooltip")).toBeNull();
    expect(
      Array.from(slot.getByRole("menu").children).map((child) => child.getAttribute("role")),
    ).not.toContain("tooltip");
    fireEvent.click(toTop);
    await waitFor(() =>
      expect(moveThread).toHaveBeenCalledWith({
        threadId: "thr_child",
        parentThreadId: null,
      }),
    );
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith(
        "Move this thread out of its parent and make it a top-level thread",
      ),
    );
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    const renameAfterHierarchy = await slot.findByRole("menuitem", {
      name: "Rename",
    });
    fireEvent.click(renameAfterHierarchy);
    fireEvent.change(slot.getByLabelText("Thread title"), {
      target: { value: "Renamed" },
    });
    fireEvent.keyDown(slot.getByLabelText("Thread title"), { key: "Enter" });
    await waitFor(() =>
      expect(slot.inspection.sidebarActionCalls).toContainEqual({
        method: "rename",
        threadId: "thr_parent",
        title: "Renamed",
      }),
    );
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Later" }));
    await waitFor(() =>
      expect(saveGroups).toHaveBeenCalledWith(expect.objectContaining({
        groups: [
          {
            id: "group_later",
            name: "Later",
            threadIds: ["thr_parent"],
          },
        ],
      })),
    );
    const groupedLink = slot.getByRole("link", { name: /Parent/ });
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Delete" }));
    fireEvent.contextMenu(slot.getByRole("link", { name: /Parent/ }));
    fireEvent.click(await slot.findByRole("menuitem", { name: "Archive" }));
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "archive",
      threadId: "thr_parent",
    });
    expect(slot.inspection.sidebarActionCalls).toContainEqual({
      method: "requestDelete",
      threadId: "thr_parent",
    });
    slot.lifecycle.unmount();
  });
});
