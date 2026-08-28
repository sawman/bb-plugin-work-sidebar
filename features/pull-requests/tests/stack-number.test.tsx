// @vitest-environment jsdom
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthoredPullRequestStack } from "../authored-pull-requests";
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
        selectedIds={new Set()}
        changingDraftUrl={null}
        onSelect={() => false}
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
    const onSelect = vi.fn(() => false);
    render(
      <AuthoredPullRequestStack
        stack={stack}
        selectedIds={new Set()}
        changingDraftUrl={null}
        onSelect={onSelect}
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
    expect(branch.querySelector("svg")).toBeTruthy();
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
    expect(onSelect).not.toHaveBeenCalled();
  });
});
