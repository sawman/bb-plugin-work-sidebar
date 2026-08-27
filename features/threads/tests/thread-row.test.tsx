// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ThreadRow } from "../thread-row";

describe("R9 Thread row host behavior", () => {
  const thread = { id: "thr_parent", title: "Parent", titleFallback: null, parentThreadId: null, isPinned: false, isUnread: false, indicator: "idle", environment: null };

  it("preserves native action ownership, shortcut attributes, modifier selection, rename, recursive archive/delete, and split handoff", () => {
    const actions = { open: vi.fn(), rename: vi.fn(), archive: vi.fn(), requestDelete: vi.fn() };
    const onSelect = vi.fn(() => false);
    const split = { onPointerDown: vi.fn() };
    const { getByRole, getByLabelText } = render(<ThreadRow thread={thread as never} actions={actions} splitProps={split} splitAvailable onSelect={onSelect} onNavigate={vi.fn()} />);
    const link = getByRole("link", { name: "Parent" });
    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe("thr_parent");
    fireEvent.click(link, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalled();
    expect(actions.open).toHaveBeenCalledWith("thr_parent", { split: false });
    fireEvent.contextMenu(link); fireEvent.click(getByRole("menuitem", { name: "Rename" }));
    fireEvent.change(getByLabelText("Thread title"), { target: { value: "Renamed" } });
    fireEvent.keyDown(getByLabelText("Thread title"), { key: "Enter" });
    expect(actions.rename).toHaveBeenCalledWith("thr_parent", "Renamed");
    fireEvent.contextMenu(getByRole("link", { name: "Renamed" }));
    fireEvent.click(getByRole("menuitem", { name: "Archive" }));
    fireEvent.click(getByRole("menuitem", { name: "Delete" }));
    expect(actions.archive).toHaveBeenCalledWith("thr_parent");
    expect(actions.requestDelete).toHaveBeenCalledWith("thr_parent");
    fireEvent.pointerDown(getByRole("link", { name: "Renamed" }), { button: 0, pointerId: 1 });
    expect(split.onPointerDown).toHaveBeenCalled();
  });
});
