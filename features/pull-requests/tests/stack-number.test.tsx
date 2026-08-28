// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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

    expect(screen.getByLabelText("Stack #17").textContent).toBe("#17");
    expect(screen.getByLabelText("Stack #17").querySelector("svg")).toBeTruthy();
  });

  it("uses the same compact stack icon and number across surfaces", () => {
    const { rerender } = render(<StackNumberBadge number={17} compact />);
    expect(screen.getByLabelText("Stack #17").textContent).toBe("#17");
    expect(screen.getByLabelText("Stack #17").querySelector("svg")).toBeTruthy();

    rerender(<StackNumberBadge number={17} />);
    expect(screen.getByLabelText("Stack #17").textContent).toBe("#17");
    expect(screen.getByLabelText("Stack #17").querySelector("svg")).toBeTruthy();
  });
});
