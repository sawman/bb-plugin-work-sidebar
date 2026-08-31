// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  open: vi.fn(),
  openNewThread: vi.fn(),
}));

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const actual = await vi.importActual<typeof import("@get-bb/plugin-sdk/app")>(
    "@get-bb/plugin-sdk/app",
  );
  return {
    ...actual,
    experimental_useSidebarThreadActions: () => ({
      openNewThread: host.openNewThread,
      requestDelete: vi.fn(),
    }),
  };
});

import { ArchivedThreadRow } from "@/components/threads/archived-thread-row";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  Reflect.deleteProperty(document, "elementFromPoint");
});

describe("ArchivedThreadRow", () => {
  it("starts a replacement thread instead of reopening an unusable archived environment", () => {
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
        onNavigate={vi.fn()}
      />,
    );

    fireEvent.click(view.getByRole("link", { name: /Archived thread/ }));
    expect(host.openNewThread).toHaveBeenCalledWith({
      projectId: "project",
      focusPrompt: true,
    });
  });
});
