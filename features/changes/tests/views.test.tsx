// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubStackBranch } from "../../../contracts";
import { changesHeaderLabel } from "../model";
import { ChangesError, ChangesStackBranchRow } from "../views";

afterEach(cleanup);

function stackBranch(
  overrides: Partial<GitHubStackBranch> = {},
): GitHubStackBranch {
  return {
    name: "feature/aligned-actions",
    isCurrent: false,
    isMerged: false,
    isQueued: false,
    needsRebase: false,
    hasStash: false,
    stashCount: null,
    pr: {
      number: 8,
      url: "https://github.com/acme/repo/pull/8",
      state: "open",
      title: "A very long pull request title that must yield to its actions",
      isDraft: false,
      metadataStale: false,
    },
    diff: {
      additions: 2,
      deletions: 1,
      files: [
        {
          path: "src/aligned.ts",
          previousPath: null,
          status: "modified",
          additions: 2,
          deletions: 1,
        },
      ],
      truncated: false,
    },
    aheadOfRemote: 0,
    behindRemote: 0,
    ...overrides,
  };
}

describe("R13 Changes error presentation", () => {
  it("renders an accessible Changes failure and retries only the Changes query", () => {
    const retry = vi.fn();
    render(
      createElement(ChangesError, {
        error: new Error("GitHub unavailable"),
        onRetry: retry,
      }),
    );

    expect(screen.getByRole("alert").textContent).toContain(
      "Could not load pull request changes",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "GitHub unavailable",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Retry pull request changes" }),
    );
    expect(retry).toHaveBeenCalledOnce();
  });

  it("labels an RPC failure as unavailable rather than no pull request", () => {
    expect(changesHeaderLabel(undefined, false, true)).toBe("Unavailable");
    expect(changesHeaderLabel(undefined, false, false)).toBe("No PR");
    expect(
      changesHeaderLabel(
        { currentPullRequest: { number: 12 } } as never,
        false,
        false,
      ),
    ).toBe("#12");
  });

  it("keeps a zero-file pull request disclosure available", () => {
    render(
      createElement(ChangesStackBranchRow, {
        branch: {
          name: "feature/empty",
          isCurrent: false,
          isMerged: false,
          isQueued: false,
          needsRebase: false,
          hasStash: false,
          stashCount: null,
          pr: {
            number: 8,
            url: "https://github.com/acme/repo/pull/8",
            state: "open",
            title: "Empty",
            isDraft: false,
            metadataStale: false,
          },
          diff: { additions: 0, deletions: 0, files: [], truncated: false },
          aheadOfRemote: 0,
          behindRemote: 0,
        },
        expanded: false,
        checkingOut: false,
        onToggle: () => undefined,
        onCheckout: () => undefined,
      } as never),
    );
    const label = screen.getByRole("button", {
      name: "#8 Empty — Show changed files for pull request #8",
    });
    expect(label.getAttribute("aria-expanded")).toBe("false");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Show changed files for pull request #8",
      }),
    );
  });

  it.each([
    { name: "ordinary", branch: stackBranch(), checkingOut: false },
    { name: "busy checkout", branch: stackBranch(), checkingOut: true },
    {
      name: "branch without a pull request",
      branch: stackBranch({ pr: null }),
      checkingOut: false,
    },
  ])(
    "keeps $name controls in one fixed trailing area with disclosure last",
    ({ branch, checkingOut }) => {
      const { container } = render(
        <ChangesStackBranchRow
          branch={branch}
          expanded={false}
          checkingOut={checkingOut}
          onToggle={() => undefined}
          onCheckout={() => undefined}
        />,
      );

      const actions = container.querySelector<HTMLElement>(
        ".ws-stack-trailing-actions",
      );
      expect(actions).toBeTruthy();
      if (!actions) throw new Error("missing trailing actions");
      expect(actions.children).toHaveLength(3);
      expect(
        actions.lastElementChild?.querySelector(".ws-stack-expand"),
      ).toBeTruthy();
      expect(
        within(actions).getByRole("button", { name: /changed files/ }),
      ).toBeTruthy();
      expect(
        within(actions).getByRole("button", {
          name: checkingOut ? /Checking out/ : /Check out/,
        }),
      ).toBeTruthy();
    },
  );

  it("keeps the disclosure in the final action slot for a zero-file pull request", () => {
    const { container } = render(
      <ChangesStackBranchRow
        branch={stackBranch({
          diff: { additions: 0, deletions: 0, files: [], truncated: false },
        })}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    const actions = container.querySelector<HTMLElement>(
      ".ws-stack-trailing-actions",
    );
    expect(actions).toBeTruthy();
    if (!actions) throw new Error("missing trailing actions");
    expect(actions.children).toHaveLength(3);
    expect(actions.lastElementChild?.childElementCount).toBe(1);
    expect(
      within(actions).getByRole("button", { name: /changed files/ }),
    ).toBeTruthy();
  });

  it("keeps a changed-files disclosure on a pull request while its diff is unavailable", () => {
    const onToggle = vi.fn();
    render(
      <ChangesStackBranchRow
        branch={stackBranch({ diff: null })}
        expanded={false}
        checkingOut={false}
        onToggle={onToggle}
        onCheckout={() => undefined}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Show changed files for pull request #8",
      }),
    );
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("keeps title, checkout, and trailing disclosure interactions isolated", () => {
    const onToggle = vi.fn();
    const onCheckout = vi.fn();
    const { container } = render(
      <ChangesStackBranchRow
        branch={stackBranch()}
        expanded={false}
        checkingOut={false}
        onToggle={onToggle}
        onCheckout={onCheckout}
      />,
    );

    const actions = container.querySelector<HTMLElement>(
      ".ws-stack-trailing-actions",
    );
    expect(actions).toBeTruthy();
    if (!actions) throw new Error("missing trailing actions");
    fireEvent.click(
      within(actions).getByRole("link", { name: /Open pull request/ }),
    );
    expect(onToggle).not.toHaveBeenCalled();
    expect(onCheckout).not.toHaveBeenCalled();
    fireEvent.click(within(actions).getByRole("button", { name: /Check out/ }));
    expect(onCheckout).toHaveBeenCalledOnce();
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(
      within(actions).getByRole("button", { name: /Show changed files/ }),
    );
    expect(onToggle).toHaveBeenCalledOnce();
    expect(onCheckout).toHaveBeenCalledOnce();
    fireEvent.click(
      within(container).getByRole("button", { name: /#8 A very long/ }),
    );
    expect(onToggle).toHaveBeenCalledTimes(2);
  });
});
