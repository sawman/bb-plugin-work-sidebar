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

beforeEach(() => {
  clipboardWrite.mockClear();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: clipboardWrite },
  });
});

describe("pull-request stack number presentation", () => {
  afterEach(cleanup);

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
    expect(pullRequest.classList.contains("ws-pr-identifier-badge")).toBe(
      true,
    );
    expect(branch.classList.contains("ws-pr-identifier-badge")).toBe(true);
    expect(branch.getAttribute("data-variant")).toBe("text");
    expect(pullRequest.getAttribute("data-variant")).toBe("badge");
    expect(stackNumber.getAttribute("data-variant")).toBe("badge");
    for (const badge of [pullRequest, stackNumber, branch]) {
      expect(badge.classList.contains("ws-identifier-badge")).toBe(true);
    }
    expect(pullRequest.getAttribute("data-tone")).toBeNull();
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
      expect(branch.textContent).toBe("feature/shared");
    }
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
    expect(title.tagName).toBe("SPAN");
    expect(title.classList.contains("ws-pr-title")).toBe(true);
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
    expect(tooltipOwners).toHaveLength(1);
    for (const owner of tooltipOwners) {
      expect(owner.matches("button, a")).toBe(true);
      expect(owner.getAttribute("data-tooltip")?.trim()).not.toBe("");
    }
    expect(container.querySelectorAll(".ws-status[data-tooltip]")).toHaveLength(
      0,
    );
  });
});
