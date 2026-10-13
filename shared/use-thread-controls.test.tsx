// @vitest-environment jsdom
import { fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { sidebarThreadFixture } from "../tests/utils/sidebar-thread";
import { useThreadControls } from "./use-thread-controls";

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));
beforeEach(() => { vi.clearAllMocks(); });

function Controls() {
  const controls = useThreadControls(sidebarThreadFixture({
    id: "thr_target", projectId: "project", parentThreadId: "thr_parent",
    archivedAt: 7, pinnedAt: 3, sectionId: "section", isUnread: true,
    environment: { id: null, path: null, name: null, branchName: null,
      isWorktree: null, providerId: null, workspaceDisplayKind: null },
  }));
  return <>
    <button onClick={() => controls.open("thr_target", { split: true })}>Open</button>
    <button onClick={() => void controls.rename("thr_target", "New title")}>Rename</button>
    <button onClick={() => void controls.archive("thr_target")}>Archive</button>
    <button onClick={() => void controls.requestDelete("thr_target")}>Delete</button>
    <button onClick={() => void controls.setPinned("thr_target", false)}>Unpin</button>
    <button onClick={() => void controls.setPinned("thr_target", true)}>Pin</button>
    <button onClick={() => void controls.setRead("thr_target", true)}>Read</button>
  </>;
}

describe("BB 0.46 thread control contracts", () => {
  it.each([
    ["Rename", "update", { threadId: "thr_target", title: "New title" }],
    ["Pin", "pin", { threadId: "thr_target" }],
    ["Unpin", "unpin", { threadId: "thr_target" }],
  ] as const)("contains rejected %s writes and surfaces the error", async (label, method, args) => {
    const rejectedWrite = vi.fn(async () => { throw new Error(`${label} denied`); });
    const slot = renderSlot({ component: Controls }, {}, {
      sdk: { threads: { [method]: rejectedWrite } },
    });
    fireEvent.click(slot.getByText(label));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(`${label} denied`));
    expect(rejectedWrite).toHaveBeenCalledOnce();
    expect(slot.inspection.sdkCalls).toEqual([{ method: `threads.${method}`, args: [args] }]);
    slot.unmount();
  });
  it("routes navigation, optimistic writes, and native lifecycle actions to their owners", () => {
    const archive = vi.fn(async () => {});
    const requestDelete = vi.fn(async () => {});
    const resolveActions = vi.fn((target) => {
      expect(target).toMatchObject({ id: "thr_target", parentThreadId: "thr_parent",
        archivedAt: 7, pinnedAt: 3, sectionId: "section", isUnread: true, environment: null });
      return [{ key: "bb--core/archive", pluginId: "bb--core", group: "lifecycle",
        action: { label: "Archive", icon: "Archive" as const, run: archive } },
      { key: "bb--core/delete", pluginId: "bb--core", group: "lifecycle",
        action: { label: "Delete", icon: "Trash2" as const, run: requestDelete } }];
    });
    const slot = renderSlot({ component: Controls }, {}, {
      threadActions: resolveActions,
      sdk: { threads: { update: vi.fn(async () => ({}) as never),
        unpin: vi.fn(async () => ({}) as never), markRead: vi.fn(async () => ({}) as never) } },
    });
    for (const label of ["Open", "Rename", "Archive", "Delete", "Unpin", "Read"])
      fireEvent.click(slot.getByText(label));
    expect(slot.inspection.navigateCalls).toEqual([{ method: "toThread", threadId: "thr_target", options: { split: true } }]);
    expect(slot.inspection.sdkCalls).toEqual([
      { method: "threads.update", args: [{ threadId: "thr_target", title: "New title" }] },
      { method: "threads.unpin", args: [{ threadId: "thr_target" }] },
      { method: "threads.markRead", args: [{ threadId: "thr_target" }] },
    ]);
    expect(archive).toHaveBeenCalledOnce();
    expect(requestDelete).toHaveBeenCalledOnce();
    slot.unmount();
  });

  it("leaves unavailable or disabled lifecycle actions with the host", () => {
    const archive = vi.fn(async () => {});
    const slot = renderSlot({ component: Controls }, {}, { threadActions: () => [
      { key: "bb--core/archive", pluginId: "bb--core", group: "lifecycle",
        action: { label: "Archive", icon: "Archive", disabled: true, run: archive } },
    ] });
    fireEvent.click(slot.getByText("Archive"));
    fireEvent.click(slot.getByText("Delete"));
    expect(archive).not.toHaveBeenCalled();
    expect(slot.inspection.sdkCalls).toEqual([]);
    slot.unmount();
  });
});
