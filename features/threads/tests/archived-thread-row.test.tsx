// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  open: vi.fn(),
  splitPointerDown: vi.fn((event: { stopPropagation(): void }) =>
    event.stopPropagation(),
  ),
}));

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const actual = await vi.importActual<typeof import("@get-bb/plugin-sdk/app")>(
    "@get-bb/plugin-sdk/app",
  );
  return {
    ...actual,
    experimental_useSidebarThreadActions: () => ({
      open: host.open,
      requestDelete: vi.fn(),
    }),
    experimental_useSidebarThreadSplit: () => ({
      splitProps: { onPointerDown: host.splitPointerDown },
      isAvailable: true,
      layout: null,
    }),
  };
});

import { ArchivedThreadRow } from "@/components/threads/archived-thread-row";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("ArchivedThreadRow pointer interaction", () => {
  it("hands the pointer to BB and still drags the whole row into a custom group", () => {
    const groupZone = document.createElement("section");
    groupZone.dataset.wsThreadDropZone = "group_later";
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => groupZone),
    });
    const onUnarchive = vi.fn();
    const view = render(
      <ArchivedThreadRow
        thread={{
          id: "thr_archived",
          projectId: "project",
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
          archivedAt: 1,
        }}
        duration="3h"
        groups={[{ id: "group_later", name: "Later" }]}
        onUnarchive={onUnarchive}
        onNavigate={vi.fn()}
        dragging={false}
        onDragThreadChange={vi.fn()}
        onDropTargetChange={vi.fn()}
      />,
    );

    const link = view.getByRole("link", { name: /Archived thread/ });
    fireEvent.pointerDown(link, {
      button: 0,
      pointerId: 7,
      clientX: 0,
      clientY: 0,
    });
    fireEvent.pointerMove(window, {
      pointerId: 7,
      clientX: 10,
      clientY: 20,
    });
    fireEvent.pointerUp(window, {
      pointerId: 7,
      clientX: 10,
      clientY: 20,
    });

    expect(host.splitPointerDown).toHaveBeenCalledTimes(1);
    expect(onUnarchive).toHaveBeenCalledWith(
      "thr_archived",
      "group_later",
    );
  });
});
