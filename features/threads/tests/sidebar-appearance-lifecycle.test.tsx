// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarTextScaleEditor } from "../sidebar-appearance-settings";
import { ThreadListSettings } from "../sidebar-group-settings";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("sidebar appearance lifecycle", () => {
  it("does not restart the text-scale debounce when parent callbacks change", async () => {
    vi.useFakeTimers();
    const save = vi.fn().mockResolvedValue({ textScale: 1.1 });
    const { rerender } = render(
      <SidebarTextScaleEditor
        saved={1}
        pending={false}
        onSave={async (value) => save(value)}
      />,
    );
    fireEvent.change(screen.getByRole("spinbutton", { name: "Text scale" }), {
      target: { value: "1.1" },
    });
    await vi.advanceTimersByTimeAsync(200);
    rerender(
      <SidebarTextScaleEditor
        saved={1}
        pending={false}
        onSave={async (value) => save(value)}
      />,
    );
    await vi.advanceTimersByTimeAsync(49);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(save).toHaveBeenCalledWith(1.1);
  });

  it("keeps a row-height save pending without blocking text-scale save", async () => {
    vi.useFakeTimers();
    const rowHeightSave = vi.fn(
      () => new Promise<{ rowHeight: number }>(() => undefined),
    );
    const textScaleSave = vi.fn().mockResolvedValue({ textScale: 1.1 });
    render(
      <ThreadListSettings
        rowHeight={40}
        rowHeightPending
        onSaveRowHeight={rowHeightSave}
        textScale={1}
        textScalePending={false}
        onSaveTextScale={textScaleSave}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Thread list settings" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Text scale" }), {
      target: { value: "1.1" },
    });
    await vi.advanceTimersByTimeAsync(250);
    expect(rowHeightSave).not.toHaveBeenCalled();
    expect(textScaleSave).toHaveBeenCalledWith(1.1);
  });
});
