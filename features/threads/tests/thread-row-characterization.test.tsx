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
  };
});

import { ThreadRow } from "../thread-row";
import type { ThreadRowProps } from "../thread-row-types";

type SidebarThreadWithDraft = PluginSidebarThread & {
  hasComposerDraft?: boolean;
};

const thread = {
  id: "thr_one",
  projectId: "project",
  title: "One",
  titleFallback: null,
  parentThreadId: null,
  providerId: "codex",
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
} as SidebarThreadWithDraft;

function renderRow({
  onSelect = () => false,
  groupId = "later",
  groups = [{ id: "later", name: "Later", threadIds: [] }],
  threadOverrides = {},
  children = 1,
  activeChildren = children,
}: {
  onSelect?: ThreadRowProps["onSelect"];
  groupId?: string | null;
  groups?: { id: string; name: string; threadIds: string[] }[];
  threadOverrides?: Partial<SidebarThreadWithDraft>;
  children?: number;
  activeChildren?: number;
} = {}) {
  const renderedThread = { ...thread, ...threadOverrides };
  const props = {
    onSelect: vi.fn(onSelect),
    onToggleChildren: vi.fn(),
    onMoveToGroup: vi.fn(),
    onMoveToRecycleBin: vi.fn(),
    onNavigate: vi.fn(),
    onDragThreadChange: vi.fn(),
    onDropTargetChange: vi.fn(),
    onDropThread: vi.fn(),
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
  const tree = () => (
    <QueryClientProvider client={client}>
      <ThreadRow
        thread={renderedThread}
        active={false}
        children={children}
        activeChildren={activeChildren}
        childrenExpanded={false}
        selected={false}
        groupId={groupId}
        groups={groups}
        project={{ name: "Project", isPersonal: false }}
        reorderDisabled={false}
        dragThreadId={null}
        dropTarget={null}
        canDropThread={() => true}
        {...props}
      />
    </QueryClientProvider>
  );
  const view = render(tree());
  return { ...view, ...props, rerenderRow: () => view.rerender(tree()) };
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

    expect(
      view
        .getByRole("button", { name: "Copy branch name feature/m7" })
        .getAttribute("data-variant"),
    ).toBe("text");

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

  it("keeps detached worktree identity and the shared PR badge presentation", async () => {
    host.pullRequest = {
      number: 42,
      title: "Detached checkout PR",
      url: "https://example.test/pull/42",
      state: "open",
      attention: "none",
    };
    const view = renderRow({
      threadOverrides: {
        environment: {
          id: "env_detached",
          name: null,
          branchName: null,
          workspaceDisplayKind: "managed-worktree",
        },
      },
    });

    const pullRequest = await view.findByRole("button", {
      name: "Copy PR number #42",
    });
    expect(pullRequest.classList).toContain("ws-pr-number-badge");
    expect(pullRequest.classList).not.toContain("ws-thread-pr-token");
    expect(pullRequest.getAttribute("aria-haspopup")).toBeNull();
    expect(document.getElementById(pullRequest.getAttribute("aria-describedby") ?? "")?.getAttribute("aria-label")).toBe(
      "PR #42 · Review pending",
    );
    const location = view.container.querySelector<HTMLElement>(
      '.ws-thread-location[data-location-kind="worktree"]',
    );
    expect(location?.textContent).toBe("Detached worktree");
    expect(location?.querySelector("svg")?.dataset.icon).toBe("Columns2");
    expect(location?.querySelector('[role="button"]')).toBeNull();
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
    host.stackNumber = 17;
    const view = renderRow({ threadOverrides: { hasComposerDraft: true } });

    expect(view.getByText("feature/m7")).toBeTruthy();
    expect(view.queryByText("WORK-1")).toBeNull();
    expect(view.getByText("#42")).toBeTruthy();
    expect(
      (await view.findByLabelText("Copy stack number #17")).textContent,
    ).toBe("#17");
    expect(document.querySelector('[aria-label="PR #42 · Review pending"]')).toBeTruthy();
    const provider = view.getByRole("img", {
      name: "codex provider status: Thread is running; 1 child agent working",
    });
    expect(provider.closest(".ws-thread-leading")).toBeTruthy();
    expect(provider.getAttribute("data-runtime-state")).toBe("working");
    expect(view.container.querySelector(".ws-status-dots")).toBeNull();
    expect(view.getByRole("img", { name: "Unsent draft" })).toBeTruthy();
    expect(view.getByRole("img", { name: "Pinned" })).toBeTruthy();
    expect(
      view.getByRole("button", { name: "1 child agent, collapsed" }),
    ).toBeTruthy();
  });

  it("keeps one provider and child-agent disclosure target even at zero", () => {
    const view = renderRow({ children: 0, activeChildren: 0 });
    const disclosure = view.getByRole("button", {
      name: "No child agents, collapsed",
    });

    expect(disclosure.getAttribute("data-empty")).toBe("true");
    expect(disclosure.querySelector("small")?.textContent).toBe("");
    expect(
      disclosure.querySelector('.ws-thread-provider[data-provider-id="codex"]'),
    ).toBeTruthy();
    fireEvent.click(disclosure.querySelector(".ws-thread-provider")!);
    expect(view.onToggleChildren).toHaveBeenCalledOnce();
    expect(view.onSelect).not.toHaveBeenCalled();
    expect(host.actions.open).not.toHaveBeenCalled();
  });

  it("shows a durable host draft without selecting or visiting the thread", () => {
    const view = renderRow({ threadOverrides: { hasComposerDraft: true } });

    expect(view.getByRole("img", { name: "Unsent draft" })).toBeTruthy();
  });

  it("requires row-level host state before showing a durable draft", () => {
    const view = renderRow();

    expect(view.queryByRole("img", { name: "Unsent draft" })).toBeNull();
  });

  it("preserves modifier selection, native row attributes, rename, and every BB-owned menu action", () => {
    const onSelect = vi.fn(() => true);
    const view = renderRow({ onSelect });
    const link = view.getByRole("link", { name: /One/ });

    expect(link.getAttribute("data-sidebar-thread-shortcut-target")).toBe("");
    expect(link.getAttribute("data-sidebar-thread-id")).toBe(thread.id);
    fireEvent.click(link, { ctrlKey: true });
    expect(onSelect).toHaveBeenCalledWith(
      thread,
      expect.objectContaining({ ctrlKey: true }),
    );
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
    fireEvent.click(
      afterRename.getByRole("menuitem", { name: "Archive" }),
    );
    expect(host.actions.archive).toHaveBeenCalledWith(thread.id);
    openMenu(afterRename);
    fireEvent.click(afterRename.getByRole("menuitem", { name: "Delete" }));
    expect(host.actions.requestDelete).toHaveBeenCalledWith(thread.id);
  });

  it("keeps pin first, delegates ordering to drag, and normalizes destination actions", () => {
    const view = renderRow({
      groups: [
        { id: "later", name: "Later", threadIds: [] },
        { id: "soon", name: "Soon", threadIds: [] },
      ],
    });

    openMenu(view);
    const menu = view.getByRole("menu", { name: "Actions for One" });
    const items = view.getAllByRole("menuitem");
    expect(items[0]?.textContent).toBe("Unpin");
    expect(items[0]?.nextElementSibling).toBe(
      view.getByRole("menuitem", { name: "Open" }),
    );
    expect(view.queryByRole("menuitem", { name: "Move up" })).toBeNull();
    expect(view.queryByRole("menuitem", { name: "Move down" })).toBeNull();
    const active = view.getByRole("menuitem", { name: "Active" });
    const later = view.getByRole("menuitem", { name: "Later" });
    const recycle = view.getByRole("menuitem", { name: "Recycle Bin" });
    const permanentArchive = view.getByRole("menuitem", {
      name: "Archive",
    });
    const menuItems = view.getAllByRole("menuitem");
    expect(active.className).toBe(later.className);
    expect(menu.classList).toContain("ws-thread-context-menu");
    expect(menu.querySelectorAll('[data-tone="destructive"]')).toHaveLength(2);
    expect(menuItems.slice(-3)).toEqual([recycle, permanentArchive, view.getByRole("menuitem", { name: "Delete" })]);

    fireEvent.click(active);
    expect(view.onMoveToGroup).toHaveBeenCalledWith(thread.id, null);

    openMenu(view);
    fireEvent.click(view.getByRole("menuitem", { name: "Soon" }));
    expect(view.onMoveToGroup).toHaveBeenCalledWith(thread.id, "soon");
  });
});
