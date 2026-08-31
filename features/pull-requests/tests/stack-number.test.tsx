// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthoredPullRequestRow,
  AuthoredPullRequestStack,
} from "../authored-pull-requests";
import { ThreadWorkspaceBadge } from "../../../components/threads/thread-workspace-badge";
import { PullRequestIdentifierBadge } from "../identifier-badge";
import { StackNumberBadge } from "../stack-number";
import { linkedThreadForStack, uniqueThreadsByBranch } from "../thread-link";
import type { SidebarStack } from "../../../work-model";

const stack = {
  id: "github-stack:acme/repo:17",
  number: 17,
  base: "main",
  currentPullRequest: 42,
  pullRequests: [
    {
      number: 42,
      title: "Expose stack identity",
      state: "open",
      draft: false,
      url: "https://github.com/acme/repo/pull/42",
      head: "feature/stack-number",
      base: "main",
      checks: "passing",
      review: "approved",
      reviewCommentCount: 0,
    },
  ],
} satisfies SidebarStack;

const clipboardWrite = vi.fn(() => Promise.resolve());

function dispatchHrefClickWithoutJsdomNavigation(
  link: HTMLElement,
  event: MouseEvent,
) {
  let componentPrevented = false;
  const stopJsdomNavigation = (dispatched: MouseEvent) => {
    componentPrevented = dispatched.defaultPrevented;
    dispatched.preventDefault();
  };
  // BB deliberately preserves modifier-click navigation. This final bubble
  // listener runs after the component handler, records that contract, then
  // prevents jsdom from attempting an unsupported document navigation.
  document.addEventListener("click", stopJsdomNavigation, { once: true });
  link.dispatchEvent(event);
  return componentPrevented;
}

beforeEach(() => {
  clipboardWrite.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

describe("pull-request stack number presentation", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("shows the real stack number in an authored PR stack", () => {
    render(
      <AuthoredPullRequestStack
        stack={stack}
        changingDraftUrl={null}
        onToggleDraft={vi.fn()}
      />,
    );

    const stackNumber = screen.getByLabelText("Copy stack number #17");
    expect(stackNumber.textContent).toBe("#17");
    expect(stackNumber.querySelector("svg")).toBeTruthy();
  });

  it("places the PR badge before the stack badge in row metadata", () => {
    render(
      <AuthoredPullRequestStack
        stack={stack}
        changingDraftUrl={null}
        onToggleDraft={vi.fn()}
      />,
    );

    const pullRequest = screen.getByRole("button", {
      name: "Copy PR number #42",
    });
    const stackNumber = screen.getByRole("button", {
      name: "Copy stack number #17",
    });
    const branch = screen.getByRole("button", {
      name: "Copy branch name feature/stack-number",
    });
    expect(pullRequest.classList).toContain("ws-pr-number-badge");
    expect(pullRequest.getAttribute("data-variant")).toBe("badge");
    expect(stackNumber.getAttribute("data-variant")).toBe("badge");
    expect(branch.getAttribute("data-variant")).toBe("text");
    expect(
      [
        ...(pullRequest.parentElement?.querySelectorAll('[role="button"]') ??
          []),
      ].map((button) => button.getAttribute("aria-label")),
    ).toEqual([
      "Copy PR number #42",
      "Copy stack number #17",
      "Copy branch name feature/stack-number",
    ]);
  });

  it("uses the same compact stack icon and number across surfaces", () => {
    const { rerender } = render(<StackNumberBadge number={17} compact />);
    expect(screen.getByLabelText("Copy stack number #17").textContent).toBe(
      "#17",
    );
    expect(
      screen.getByLabelText("Copy stack number #17").querySelector("svg"),
    ).toBeTruthy();

    rerender(<StackNumberBadge number={17} />);
    expect(screen.getByLabelText("Copy stack number #17").textContent).toBe(
      "#17",
    );
    expect(
      screen.getByLabelText("Copy stack number #17").querySelector("svg"),
    ).toBeTruthy();
  });

  it("copies PR, stack, and branch values without selecting or opening the row", async () => {
    render(
      <AuthoredPullRequestStack
        stack={stack}
        changingDraftUrl={null}
        onToggleDraft={vi.fn()}
      />,
    );

    const pullRequest = screen.getByRole("button", {
      name: "Copy PR number #42",
    });
    fireEvent.click(pullRequest);
    const stackNumber = screen.getByRole("button", {
      name: "Copy stack number #17",
    });
    fireEvent.click(stackNumber);
    const branch = screen.getByRole("button", {
      name: "Copy branch name feature/stack-number",
    });
    expect(pullRequest.classList.contains("ws-pr-identifier-badge")).toBe(true);
    expect(branch.classList.contains("ws-pr-identifier-badge")).toBe(true);
    expect(branch.getAttribute("data-variant")).toBe("text");
    expect(pullRequest.getAttribute("data-variant")).toBe("badge");
    expect(stackNumber.getAttribute("data-variant")).toBe("badge");
    for (const badge of [pullRequest, stackNumber, branch]) {
      expect(badge.classList.contains("ws-identifier-badge")).toBe(true);
    }
    expect(pullRequest.getAttribute("data-tone")).toBe("success");
    expect(branch.getAttribute("data-tone")).toBeNull();
    expect(pullRequest.querySelector("svg")).toBeTruthy();
    expect(branch.querySelector("svg")).toBeNull();
    fireEvent.keyDown(branch, { key: "Enter" });
    fireEvent.keyDown(branch, { key: " " });

    await waitFor(() =>
      expect(clipboardWrite.mock.calls).toEqual([
        ["PR #42"],
        ["Stack #17"],
        ["Branch feature/stack-number"],
        ["Branch feature/stack-number"],
      ]),
    );
  });

  it("uses one quiet branch-name presentation in PR and thread metadata", () => {
    render(
      <>
        <PullRequestIdentifierBadge kind="branch" name="feature/shared" />
        <ThreadWorkspaceBadge
          branchName="feature/shared"
          projectLabel="Work sidebar"
        />
      </>,
    );

    const branches = screen.getAllByRole("button", {
      name: "Copy branch name feature/shared",
    });
    expect(branches).toHaveLength(2);
    for (const branch of branches) {
      expect(branch.classList.contains("ws-branch-name")).toBe(true);
      expect(branch.getAttribute("data-variant")).toBe("text");
      expect(branch.getAttribute("data-typography")).toBeNull();
      expect(branch.textContent).toBe("feature/shared");
    }
    expect(branches[0]?.querySelector("svg")).toBeNull();
    expect(branches[1]?.querySelector("svg")?.getAttribute("data-icon")).toBe(
      "GitBranch",
    );
  });

  it("opens a uniquely linked thread from its provider in the trailing rail", () => {
    const provider = { id: "codex", displayName: "Codex", logoUrl: null };
    const openThread = vi.fn();
    const rootWithChild = {
      id: "thr_root",
      title: "Root branch owner",
      branchName: "feature/root-with-child",
      providerId: "codex",
      provider,
      parentThreadId: null,
    };
    const childOnRootBranch = {
      id: "thr_child",
      title: "Child worker",
      branchName: "feature/root-with-child",
      providerId: "codex",
      provider,
      parentThreadId: "thr_root",
    };
    const unique = uniqueThreadsByBranch([
      {
        id: "thr_unique",
        title: "Implement the PR",
        branchName: "feature/unique",
        providerId: "codex",
        provider,
      },
      {
        id: "thr_duplicate_a",
        title: "Duplicate A",
        branchName: "feature/duplicate",
        providerId: "codex",
        provider,
      },
      {
        id: "thr_duplicate_b",
        title: "Duplicate B",
        branchName: "feature/duplicate",
        providerId: "codex",
        provider,
      },
      rootWithChild,
      childOnRootBranch,
    ]);

    expect(unique.get("feature/unique")?.id).toBe("thr_unique");
    expect(unique.has("feature/duplicate")).toBe(false);
    expect(unique.get("feature/root-with-child")?.id).toBe("thr_root");

    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 93,
          title: "Unique branch",
          url: "https://github.com/acme/repo/pull/93",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/unique",
          base: "main",
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        linkedThread={unique.get("feature/unique")}
        changingDraft={false}
        onOpenThread={openThread}
        onToggleDraft={vi.fn()}
      />,
    );

    const thread = screen.getByRole("button", {
      name: "Open linked thread Implement the PR",
    });
    expect(thread.getAttribute("title")).toBeNull();
    expect(thread.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toBe("Implement the PR");
    expect(thread.parentElement?.classList).toContain("ws-pr-status-icons");
    expect(document.querySelector(".ws-pr-thread-context")).toBeNull();
    expect(thread.querySelector('[data-provider-id="codex"]')).toBeTruthy();
    fireEvent.click(thread);
    expect(openThread).toHaveBeenCalledWith("thr_unique");
    expect(clipboardWrite).not.toHaveBeenCalled();
  });

  it("promotes a lower stack layer's linked provider to the top PR only", () => {
    const provider = {
      id: "claude-code",
      displayName: "Claude",
      logoUrl: null,
    };
    const lowerThread = {
      id: "thr_lower",
      title: "Implement lower layer",
      branchName: "feature/child",
      providerId: "claude-code",
      provider,
    };
    const stacked = {
      ...stack,
      pullRequests: [
        stack.pullRequests[0]!,
        {
          ...stack.pullRequests[0]!,
          number: 43,
          title: "Lower stack layer",
          url: "https://github.com/acme/repo/pull/43",
          head: "feature/child",
          base: "feature/stack-number",
        },
      ],
    } satisfies SidebarStack;
    const threadsByBranch = new Map([["feature/child", lowerThread]]);

    expect(linkedThreadForStack(stacked.pullRequests, threadsByBranch)).toBe(
      lowerThread,
    );
    render(
      <AuthoredPullRequestStack
        stack={stacked}
        changingDraftUrl={null}
        threadsByBranch={threadsByBranch}
        onOpenThread={vi.fn()}
        onToggleDraft={vi.fn()}
      />,
    );

    const providerButton = screen.getByRole("button", {
      name: "Open linked thread Implement lower layer",
    });
    expect(providerButton.closest("article")?.textContent).toContain(
      "Expose stack identity",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Expand stack layers" }),
    );
    expect(
      screen.getAllByRole("button", {
        name: "Open linked thread Implement lower layer",
      }),
    ).toHaveLength(1);
    expect(providerButton.closest("article")?.textContent).not.toContain(
      "Lower stack layer",
    );
  });

  it("moves pull request state into the PR badge context menu", () => {
    const toggleDraft = vi.fn();
    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 94,
          title: "Badge-owned state",
          url: "https://github.com/acme/repo/pull/94",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/badge-state",
          base: "main",
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={toggleDraft}
      />,
    );

    const badge = screen.getByRole("button", { name: "Copy PR number #94" });
    expect(badge.closest("a")).toBeNull();
    expect(badge.getAttribute("data-tone")).toBe("success");
    expect(badge.getAttribute("title")).toContain("Ready to merge");
    expect(screen.queryByRole("button", { name: "Mark draft" })).toBeNull();
    fireEvent.contextMenu(badge, { clientX: 12, clientY: 18 });
    const action = screen.getByRole("menuitem", { name: "Mark draft" });
    fireEvent.click(action);
    expect(toggleDraft).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(badge, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menuitem", { name: "Mark draft" })).toBeTruthy();
  });

  it.each([
    ["Draft", "draft", "GitPullRequest", { draft: true, attention: "draft" }],
    ["Review pending", "open", "Eye", { draft: false, attention: "review_requested" }],
    ["CI failure", "destructive", "X", { draft: false, attention: "checks_failed" }],
    ["Changes requested", "destructive", "X", { draft: false, attention: "changes_requested" }],
    ["Conflicts", "destructive", "X", { draft: false, attention: "conflicts" }],
    ["Ready to merge", "success", "Check", { draft: false, attention: "ready_to_merge" }],
  ])(
    "exposes the %s status label, tone, and icon from the PR badge",
    (label, tone, icon, state) => {
      const { unmount } = render(
        <AuthoredPullRequestRow
          pullRequest={{
            number: 96,
            title: `${label} pull request`,
            url: "https://github.com/acme/repo/pull/96",
            repository: "acme/repo",
            state: state.draft ? "draft" : "open",
            draft: state.draft,
            attention: state.attention,
            head: "feature/status-badge",
            base: "main",
            checks: "passing",
            review: "approved",
            reviewCommentCount: 0,
          }}
          changingDraft={false}
          onToggleDraft={vi.fn()}
        />,
      );

      const badge = screen.getByRole("button", {
        name: "Copy PR number #96",
      });
      expect(badge.getAttribute("data-tone")).toBe(tone);
      expect(badge.getAttribute("title")).toBe(`PR #96 · ${label}`);
      expect(badge.querySelector("svg")?.getAttribute("data-icon")).toBe(icon);
      unmount();
    },
  );

  it("keeps title navigation while the whole row owns an informative context menu", () => {
    const openPullRequest = vi.fn();
    const openThread = vi.fn();
    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 95,
          title: "Context menu ownership",
          url: "https://github.com/acme/repo/pull/95",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/context-menu",
          base: "main",
          checks: "passing",
          review: "review_required",
          requestedReviewers: ["octocat", "platform-team"],
          reviewCommentCount: 0,
        }}
        linkedThread={{
          id: "thr_context",
          title: "Implement context menu",
          branchName: "feature/context-menu",
          providerId: "codex",
          parentThreadId: null,
        }}
        changingDraft={false}
        onOpenPullRequest={openPullRequest}
        onOpenThread={openThread}
        onToggleDraft={vi.fn()}
      />,
    );

    const title = screen.getByRole("link", {
      name: "Open pull request #95: Context menu ownership",
    });
    expect(title.getAttribute("href")).toBe(
      "https://github.com/acme/repo/pull/95",
    );

    const ordinaryClick = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
    });
    expect(title.dispatchEvent(ordinaryClick)).toBe(false);
    expect(ordinaryClick.defaultPrevented).toBe(true);
    expect(openPullRequest).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/95",
    );
    openPullRequest.mockClear();

    for (const modifier of [
      { metaKey: true },
      { ctrlKey: true },
      { shiftKey: true },
      { altKey: true },
    ]) {
      const modifiedClick = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        button: 0,
        ...modifier,
      });
      expect(dispatchHrefClickWithoutJsdomNavigation(title, modifiedClick)).toBe(
        false,
      );
    }
    expect(openPullRequest).not.toHaveBeenCalled();
    fireEvent.contextMenu(title, { clientX: 12, clientY: 18 });
    expect(screen.getByRole("menu").getAttribute("data-portalled")).toBe(
      "true",
    );
    expect(
      screen
        .getByRole("menuitem", { name: "CI: Checks passing" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitem", {
          name: "Review: Review required",
        })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    expect(
      screen
        .getByRole("menuitem", {
          name: "Reviewers: octocat, platform-team",
        })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open pull request" }),
    );
    expect(openPullRequest).toHaveBeenCalledWith(
      "https://github.com/acme/repo/pull/95",
    );

    fireEvent.contextMenu(title, { clientX: 12, clientY: 18 });
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Open linked thread" }),
    );
    expect(openThread).toHaveBeenCalledWith("thr_context");

    const provider = screen.getByRole("button", {
      name: "Open linked thread Implement context menu",
    });
    expect(provider.getAttribute("title")).toBeNull();
    expect(provider.getAttribute("aria-describedby")).toBeTruthy();
    expect(screen.getByRole("tooltip").textContent).toBe(
      "Implement context menu",
    );
  });

  it("flips and clamps the context menu when the pointer is near the viewport edge", async () => {
    vi.stubGlobal("innerWidth", 320);
    vi.stubGlobal("innerHeight", 240);
    const bounds = vi
      .spyOn(HTMLElement.prototype, "getBoundingClientRect")
      .mockImplementation(function (this: HTMLElement) {
        const width = this.getAttribute("role") === "menu" ? 220 : 0;
        const height = this.getAttribute("role") === "menu" ? 120 : 0;
        return {
          bottom: height,
          height,
          left: 0,
          right: width,
          top: 0,
          width,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        };
      });

    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 96,
          title: "Viewport-aware context menu",
          url: "https://github.com/acme/repo/pull/96",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/context-position",
          base: "main",
          checks: "passing",
          review: "approved",
          requestedReviewers: [],
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={vi.fn()}
      />,
    );

    fireEvent.contextMenu(
      screen.getByRole("link", {
        name: "Open pull request #96: Viewport-aware context menu",
      }),
      { clientX: 300, clientY: 220 },
    );

    const menu = screen.getByRole("menu");
    expect(
      screen
        .getByRole("menuitem", { name: "Reviewers: None requested" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
    await waitFor(() => {
      expect(menu.style.left).toBe("92px");
      expect(menu.style.top).toBe("100px");
    });
    bounds.mockRestore();
  });

  it("keeps the authored row metadata shape when branch data is unavailable", () => {
    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 91,
          title: "Unavailable branch",
          url: "https://github.com/acme/repo/pull/91",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "",
          base: "",
          checks: "unknown",
          review: "none",
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={vi.fn()}
      />,
    );

    expect(screen.queryByText("Authored by you")).toBeNull();
    expect(screen.getByText("Branch unavailable")).toBeTruthy();
  });

  it("renders authored pull request titles at regular weight", () => {
    render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 92,
          title: "Regular weight title",
          url: "https://github.com/acme/repo/pull/92",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/regular-title",
          base: "main",
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={vi.fn()}
      />,
    );

    const title = screen.getByText("Regular weight title");
    expect(title.tagName).toBe("A");
    expect(title.classList.contains("ws-sidebar-row-title")).toBe(true);
  });

  it("gives custom tooltips only to interactive controls with text", () => {
    const { container } = render(
      <AuthoredPullRequestRow
        pullRequest={{
          number: 93,
          title: "Tooltip ownership",
          url: "https://github.com/acme/repo/pull/93",
          repository: "acme/repo",
          state: "open",
          draft: false,
          head: "feature/tooltips",
          base: "main",
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        changingDraft={false}
        onToggleDraft={vi.fn()}
      />,
    );

    const tooltipOwners = [...container.querySelectorAll("[data-tooltip]")];
    expect(tooltipOwners).toHaveLength(0);
    for (const owner of tooltipOwners) {
      expect(owner.matches("button, a")).toBe(true);
      expect(owner.getAttribute("data-tooltip")?.trim()).not.toBe("");
    }
    expect(container.querySelectorAll(".ws-status[data-tooltip]")).toHaveLength(
      0,
    );
    expect(
      screen
        .getByRole("button", { name: "Copy PR number #93" })
        .getAttribute("title"),
    ).toBe("PR #93 · Ready to merge");
  });
});
