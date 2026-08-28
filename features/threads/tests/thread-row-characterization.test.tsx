// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, describe, expect, it, vi } from "vitest";

const host = vi.hoisted(() => ({
  actions: {
    open: vi.fn(),
    rename: vi.fn(),
    archive: vi.fn(),
    requestDelete: vi.fn(),
    setPinned: vi.fn(),
    setRead: vi.fn(),
  },
  pullRequest: null as unknown,
  pullRequestLoading: false,
  stackNumber: null as number | null,
  rpcCall: vi.fn(),
  composerView: {
    scope: { kind: "none" },
    draft: { isEmpty: true },
  } as unknown,
}));

const clipboardWrite = vi.fn(() => Promise.resolve());

vi.mock("@get-bb/plugin-sdk/app", async () => {
  const actual = await vi.importActual<typeof import("@get-bb/plugin-sdk/app")>(
    "@get-bb/plugin-sdk/app",
  );
  return {
    ...actual,
    experimental_useSidebarThreadActions: () => host.actions,
    experimental_useSidebarThreadSplit: () => ({
      splitProps: {},
      isAvailable: true,
      layout: null,
    }),
    experimental_useSidebarThreadPullRequest: () => ({
      pullRequest: host.pullRequest,
      isLoading: host.pullRequestLoading,
    }),
    useRpc: () => ({ call: host.rpcCall }),
    useComposerView: () => host.composerView,
  };
});

import { ThreadRow } from "../thread-row";
import type { ThreadRowProps } from "../thread-row-types";

const thread = {
  id: "thr_one",
  projectId: "project",
  title: "One",
  titleFallback: null,
  parentThreadId: null,
  indicator: "runtime",
  indicatorLabel: "Thread is running",
  isUnread: true,
  isPinned: true,
  environment: {
    id: "env_one",
    name: "Workspace",
    branchName: "feature/m7",
    workspaceDisplayKind: "managed-worktree",
  },
} as PluginSidebarThread;

function renderRow({
  onSelect = () => false,
  groupId = "later",
  groups = [{ id: "later", name: "Later", threadIds: [] }],
  threadOverrides = {},
}: {
  onSelect?: ThreadRowProps["onSelect"];
  groupId?: string | null;
  groups?: { id: string; name: string; threadIds: string[] }[];
  threadOverrides?: Partial<PluginSidebarThread>;
} = {}) {
  const renderedThread = { ...thread, ...threadOverrides };
  const props = {
    onSelect: vi.fn(onSelect),
    onToggleChildren: vi.fn(),
    onMoveToGroup: vi.fn(),
    onNavigate: vi.fn(),
    onDragThreadChange: vi.fn(),
    onDropTargetChange: vi.fn(),
    onDropThread: vi.fn(),
    onMoveThread: vi.fn(),
  };
  host.rpcCall.mockImplementation(
    async (method: string, input: { threadIds?: string[] }) => {
      if (method !== "sidebarPullRequestStacks")
        throw new Error(`unexpected ${method}`);
      const threadId = input.threadIds?.[0] ?? thread.id;
      return {
        available: true,
        stacks:
          host.stackNumber == null
            ? {}
            : {
                [threadId]: {
                  id: `github-stack:${threadId}:${host.stackNumber}`,
                  number: host.stackNumber,
                  base: "main",
                  currentPullRequest: 42,
                  pullRequests: [],
                },
              },
        mergeTargets: {},
        error: null,
      };
    },
  );
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <ThreadRow
        thread={renderedThread}
        active={false}
        children={1}
        activeChildren={1}
        childrenExpanded={false}
        selected={false}
        groupId={groupId}
        groups={groups}
        project={{ name: "Project", isPersonal: false }}
        reorderDisabled={false}
        canMoveUp={true}
        canMoveDown={true}
        dragThreadId={null}
        dropTarget={null}
        canDropThread={() => true}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { ...view, ...props };
}

function openMenu(view: ReturnType<typeof renderRow>) {
  fireEvent.contextMenu(view.getByRole("link", { name: /One/ }));
}

afterEach(() => {
  cleanup();
  for (const action of Object.values(host.actions)) action.mockReset();
  host.pullRequest = null;
  host.pullRequestLoading = false;
  host.stackNumber = null;
  host.rpcCall.mockReset();
  host.composerView = { scope: { kind: "none" }, draft: { isEmpty: true } };
  clipboardWrite.mockClear();
});

describe("R21D ThreadRow characterization", () => {
  it("copies metadata badges before the row can select, open, or drag", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    host.pullRequest = {
      number: 42,
      title: "M7",
      url: "https://example.test/pull/42",
      state: "open",
      attention: "none",
    };
    host.stackNumber = 17;
    const view = renderRow();

    for (const name of [
      "Copy PR number #42",
      "Copy stack number #17",
      "Copy branch name feature/m7",
    ]) {
      const badge = await view.findByRole("button", { name });
      expect(badge.classList).toContain("ws-identifier-badge");
      fireEvent.pointerDown(badge, { button: 0, pointerId: 9 });
      fireEvent.click(badge);
      fireEvent.contextMenu(badge, { ctrlKey: true });
    }

    await waitFor(() =>
      expect(clipboardWrite.mock.calls).toEqual([
        ["PR #42"],
        ["Stack #17"],
        ["Branch feature/m7"],
      ]),
    );
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(host.actions.open).not.toHaveBeenCalled();
    expect(view.onDragThreadChange).not.toHaveBeenCalled();
  });

  it("bolds only attention states instead of generic unread updates", () => {
    const genericUnread = renderRow({
      threadOverrides: {
        indicator: "none",
        indicatorLabel: null,
        isUnread: true,
      },
    });
    expect(
      genericUnread.container.querySelector(".ws-thread-title")?.classList,
    ).not.toContain("ws-thread-attention");
    genericUnread.unmount();

    for (const indicator of [
      "waiting-for-input",
      "unread-error",
      "unread-success",
    ] as const) {
      const actionable = renderRow({
        threadOverrides: {
          indicator,
          indicatorLabel: indicator,
          isUnread: true,
        },
      });
      expect(
        actionable.container.querySelector(".ws-thread-title")?.classList,
      ).toContain("ws-thread-attention");
      expect(actionable.container.textContent).not.toContain("•");
      actionable.unmount();
    }
  });

  it("keeps status and PR metadata without duplicating task mappings", async () => {
    host.pullRequest = {
      number: 42,
      title: "M7",
      url: "https://example.test/pull/42",
      state: "open",
      attention: "review_requested",
    };
    host.composerView = {
      scope: { kind: "thread", threadId: thread.id },
      draft: { isEmpty: false },
    };
    host.stackNumber = 17;
    const view = renderRow();

    expect(view.getByText("feature/m7")).toBeTruthy();
    expect(view.queryByText("WORK-1")).toBeNull();
    expect(view.getByText("#42")).toBeTruthy();
    expect(
      (await view.findByLabelText("Copy stack number #17")).textContent,
    ).toBe("#17");
    expect(view.getByTitle("PR #42 · Open")).toBeTruthy();
    expect(view.getByRole("img", { name: "Thread is running" })).toBeTruthy();
    expect(view.getByRole("img", { name: "Unsent draft" })).toBeTruthy();
    expect(view.getByRole("img", { name: "Pinned" })).toBeTruthy();
    expect(view.getByRole("button", { name: "1 child agent, collapsed" })).toBeTruthy();
  });

  it("preserves modifier selection, native row attributes, rename, and every BB-owned menu action", () => {
    const onSelect = vi.fn(() => true);
    const view = renderRow({ onSelect });
    const link = view.getByRole("link", { name: /One/ });

    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe(thread.id);
    fireEvent.click(link, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith(thread, expect.objectContaining({ ctrlKey: true }));
    expect(host.actions.open).not.toHaveBeenCalled();
    fireEvent.keyDown(link, { key: "ContextMenu" });
    expect(view.getByRole("menu", { name: "Actions for One" })).toBeTruthy();

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Open" }));
    expect(host.actions.open).toHaveBeenCalledWith(thread.id, { split: false });
    expect(view.onNavigate).toHaveBeenCalledTimes(1);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Open in split" }));
    expect(host.actions.open).toHaveBeenCalledWith(thread.id, { split: true });

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Unpin" }));
    expect(host.actions.setPinned).toHaveBeenCalledWith(thread.id, false);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Mark read" }));
    expect(host.actions.setRead).toHaveBeenCalledWith(thread.id, true);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Rename" }));
    const input = view.getByLabelText("Thread title");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(host.actions.rename).toHaveBeenCalledWith(thread.id, "Renamed");

    const afterRename = renderRow();
    openMenu(afterRename);
    fireEvent.click(afterRename.getByRole("menuitem", { name: "Archive" }));
    expect(host.actions.archive).toHaveBeenCalledWith(thread.id);
    openMenu(afterRename);
    fireEvent.click(afterRename.getByRole("menuitem", { name: "Delete" }));
    expect(host.actions.requestDelete).toHaveBeenCalledWith(thread.id);
  });

  it("routes extracted menu movement and destination actions to the row owners", () => {
    const view = renderRow({
      groups: [
        { id: "later", name: "Later", threadIds: [] },
        { id: "soon", name: "Soon", threadIds: [] },
      ],
    });

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Move up" }));
    expect(view.onMoveThread).toHaveBeenCalledWith(thread.id, -1);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Move down" }));
    expect(view.onMoveThread).toHaveBeenCalledWith(thread.id, 1);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Active" }));
    expect(view.onMoveToGroup).toHaveBeenCalledWith(thread.id, null);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Soon" }));
    expect(view.onMoveToGroup).toHaveBeenCalledWith(thread.id, "soon");
  });
});
