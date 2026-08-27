// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  splitPointerDown: vi.fn(),
}));

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const actual = await vi.importActual<typeof import("@get-bb/plugin-sdk/app")>(
    "@get-bb/plugin-sdk/app",
  );
  return {
    ...actual,
    experimental_useSidebarThreadActions: () => ({
      open: vi.fn(),
      rename: vi.fn(),
      archive: vi.fn(),
      requestDelete: vi.fn(),
    }),
    experimental_useSidebarThreadSplit: () => ({
      splitProps: { onPointerDown: host.splitPointerDown },
      isAvailable: true,
      layout: null,
    }),
    experimental_useSidebarThreadPullRequest: () => ({
      pullRequest: null,
      isLoading: false,
    }),
    useComposerView: () => ({
      scope: { kind: "none" },
      draft: { isEmpty: true },
    }),
  };
});

import { ThreadRow } from "../thread-row";

const thread = {
  id: "thr_one",
  projectId: "project",
  title: "One",
  titleFallback: null,
  parentThreadId: null,
  indicator: "none",
  indicatorLabel: null,
  isUnread: false,
  isPinned: false,
  environment: null,
} as PluginSidebarThread;

function renderRow(reorderDisabled: boolean) {
  const onDragThreadChange = vi.fn();
  const onDropTargetChange = vi.fn();
  const view = render(
    <ThreadRow
      thread={thread}
      active={false}
      children={0}
      activeChildren={0}
      childrenExpanded={false}
      selected={false}
      groupId={null}
      groups={[]}
      onToggleChildren={vi.fn()}
      onSelect={() => false}
      onMoveToGroup={vi.fn()}
      onNavigate={vi.fn()}
      reorderDisabled={reorderDisabled}
      canMoveUp={false}
      canMoveDown={false}
      dragThreadId={null}
      onDragThreadChange={onDragThreadChange}
      dropTarget={null}
      onDropTargetChange={onDropTargetChange}
      canDropThread={() => true}
      onDropThread={vi.fn()}
      onMoveThread={vi.fn()}
    />,
  );
  return { ...view, onDragThreadChange, onDropTargetChange };
}

afterEach(() => {
  cleanup();
  host.splitPointerDown.mockReset();
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("ThreadRow split ownership", () => {
  it("keeps native split off excluded targets and non-primary pointers, but hands primary row pointers to BB before optional reorder", () => {
    const disabled = renderRow(true);
    const row = disabled.container.querySelector<HTMLElement>("[data-ws-thread-id]")!;

    fireEvent.pointerDown(row, { button: 0, pointerId: 1, clientX: 0, clientY: 0 });
    expect(host.splitPointerDown).toHaveBeenCalledTimes(1);
    expect(disabled.onDragThreadChange).not.toHaveBeenCalled();

    host.splitPointerDown.mockClear();
    for (const tag of ["button", "input", "textarea"] as const) {
      const target = document.createElement(tag);
      row.append(target);
      fireEvent.pointerDown(target, { button: 0, pointerId: 2, clientX: 0, clientY: 0 });
      target.remove();
    }
    fireEvent.pointerDown(row, { button: 2, pointerId: 3, clientX: 0, clientY: 0 });
    expect(host.splitPointerDown).not.toHaveBeenCalled();
    expect(disabled.onDragThreadChange).not.toHaveBeenCalled();

    const enabled = renderRow(false);
    const enabledRow = enabled.container.querySelector<HTMLElement>("[data-ws-thread-id]")!;
    const target = document.createElement("div");
    target.dataset.wsThreadId = "thr_two";
    enabledRow.parentElement!.append(target);
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: () => target,
    });
    vi.spyOn(target, "getBoundingClientRect").mockReturnValue({
      top: 0,
      height: 100,
    } as DOMRect);
    fireEvent.pointerDown(enabledRow, { button: 0, pointerId: 4, clientX: 0, clientY: 0 });
    fireEvent.pointerMove(window, { pointerId: 4, clientX: 10, clientY: 10 });
    expect(host.splitPointerDown).toHaveBeenCalledTimes(1);
    expect(enabled.onDragThreadChange).toHaveBeenCalledWith("thr_one");
  });
});
