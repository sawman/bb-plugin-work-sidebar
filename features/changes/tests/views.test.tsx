// @vitest-environment jsdom
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GitHubStackBranch } from "../../../contracts";
import { changesHeaderLabel } from "../model";
import { ChangesCurrentPullRequestRow, ChangesError, ChangesStackBranchRow } from "../views";
import { currentPr } from "./latency-fixtures";
import { dispatchHrefClickWithoutJsdomNavigation } from "../../../tests/utils/dispatch-href-click";
import { renderPluginComponent as render } from "../../../tests/utils/render-plugin-component";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

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
  it.each(["current", "stack"] as const)(
    "copies the resolved %s PR URL from an independent leading badge",
    (rowKind) => {
      const onToggle = vi.fn();
      const onCheckout = vi.fn();
      const onParentClick = vi.fn();
      const onParentKeyDown = vi.fn();
      const clipboardWrite = vi.fn().mockResolvedValue(undefined);
      vi.stubGlobal("navigator", { clipboard: { writeText: clipboardWrite } });
      const openWindow = vi.spyOn(window, "open").mockReturnValue(null);
      const canonicalUrl = "https://github.com/acme/canonical/pull/8";
      const branch = stackBranch();
      const row = rowKind === "current" ? (
        <ChangesCurrentPullRequestRow
          pullRequest={{ ...currentPr(8, branch.pr!.title ?? undefined), url: canonicalUrl }}
          branch={branch}
          expanded={false}
          externalOnModifier
          onToggle={onToggle}
          onOpenFile={() => undefined}
        />
      ) : (
        <ChangesStackBranchRow
          branch={branch}
          signals={{ state: "open", draft: false, checks: "passing", review: "approved", reviewCommentCount: 0, url: canonicalUrl }}
          expanded={false}
          externalOnModifier
          checkingOut={false}
          onToggle={onToggle}
          onCheckout={onCheckout}
        />
      );
      const { container } = render(
        <div onClick={onParentClick} onKeyDown={onParentKeyDown}>{row}</div>,
      );
      const badge = screen.getByRole("button", { name: "Copy PR URL #8" });
      const titleToggle = screen.getByRole("button", {
        name: `#8 ${branch.pr!.title} — Show changed files for pull request #8`,
      });
      const githubLink = screen.getByRole("link", { name: "Open pull request #8 on GitHub" });
      const onNavigate = vi.fn();
      githubLink.addEventListener("click", onNavigate);
      expect(githubLink.getAttribute("href")).toBe(canonicalUrl);
      expect(badge.textContent).toBe("#8");
      expect(badge.tabIndex).toBe(0);
      expect(badge.parentElement?.closest('button, a, [role="button"]')).toBeNull();
      expect(titleToggle.contains(badge)).toBe(false);
      expect(badge.compareDocumentPosition(titleToggle) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(container.querySelector('button button, button [role="button"], a [role="button"]')).toBeNull();
      expect(titleToggle.getAttribute("aria-expanded")).toBe("false");

      badge.focus();
      expect(document.activeElement).toBe(badge);
      expect(screen.getByRole("tooltip", { name: "Copy PR URL" })).toBeTruthy();
      fireEvent.pointerDown(badge);
      fireEvent.mouseDown(badge);
      fireEvent.click(badge);
      fireEvent.click(badge, { metaKey: true });
      fireEvent.keyDown(badge, { key: "Enter" });
      fireEvent.keyDown(badge, { key: " " });
      expect(clipboardWrite.mock.calls).toEqual(Array.from({ length: 4 }, () => [canonicalUrl]));
      expect(onToggle).not.toHaveBeenCalled();
      expect(onCheckout).not.toHaveBeenCalled();
      expect(onParentClick).not.toHaveBeenCalled();
      expect(onParentKeyDown).not.toHaveBeenCalled();
      expect(onNavigate).not.toHaveBeenCalled();
      expect(openWindow).not.toHaveBeenCalled();
      expect(titleToggle.getAttribute("aria-expanded")).toBe("false");

      fireEvent.click(titleToggle);
      expect(onToggle).toHaveBeenCalledOnce();
      expect(clipboardWrite).toHaveBeenCalledTimes(4);
      dispatchHrefClickWithoutJsdomNavigation(githubLink,
        new MouseEvent("click", { bubbles: true, cancelable: true, metaKey: true }));
      expect(openWindow).toHaveBeenCalledWith(canonicalUrl, "_blank", "noopener,noreferrer");
      expect(onToggle).toHaveBeenCalledOnce();
      if (rowKind === "stack") {
        fireEvent.click(screen.getByRole("button", { name: /Check out/ }));
        expect(onCheckout).toHaveBeenCalledOnce();
        expect(onToggle).toHaveBeenCalledOnce();
      }
    },
  );

  it("does not add a PR copy badge to a non-PR branch", () => {
    render(<ChangesStackBranchRow
      branch={stackBranch({ pr: null, diff: null })}
      expanded={false}
      checkingOut={false}
      onToggle={() => undefined}
      onCheckout={() => undefined}
    />);
    expect(screen.queryByRole("button", { name: /Copy PR URL/ })).toBeNull();
    expect(screen.queryByRole("link", { name: /Open pull request/ })).toBeNull();
    expect(screen.getByRole("button", { name: "feature/aligned-actions" }).getAttribute("aria-disabled")).toBe("true");
  });

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

  it("uses the shared bounded file-list container for expanded pull requests", () => {
    const { container } = render(
      <ChangesStackBranchRow
        branch={stackBranch()}
        expanded
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    expect(
      container
        .querySelector(".ws-stack-files")
        ?.classList.contains("ws-changes-file-list-scroll"),
    ).toBe(true);
  });

  it("uses PR review and CI signals for the summary status badge", () => {
    const { rerender } = render(
      <ChangesStackBranchRow
        branch={stackBranch()}
        signals={{
          state: "open",
          draft: false,
          checks: "failed",
          review: "approved",
          reviewCommentCount: 0,
        }}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "CI failure" })).toBeTruthy();

    rerender(
      <ChangesStackBranchRow
        branch={stackBranch()}
        signals={{
          state: "open",
          draft: false,
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "Ready to merge" })).toBeTruthy();

    rerender(
      <ChangesStackBranchRow
        branch={stackBranch()}
        signals={{
          state: "open",
          draft: false,
          attention: "review_requested",
          checks: "passing",
          review: "approved",
          reviewCommentCount: 0,
        }}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    expect(screen.getByRole("img", { name: "Ready to merge" })).toBeTruthy();
  });

  it("splits resolved and unresolved review comments at the stack subtitle metadata size", () => {
    render(
      <ChangesStackBranchRow
        branch={stackBranch()}
        signals={{
          state: "open",
          draft: false,
          checks: "passing",
          review: "review_requested",
          requestedReviewers: ["reviewer-a", "platform-team"],
          reviewCommentCount: 7,
          reviewCommentCounts: { unresolved: 3, resolved: 4 },
        }}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    const review = screen.getByRole("img", {
      name: "Review: reviewer-a, platform-team, 3 unresolved review comments, 4 resolved review comments",
    });
    expect(review.getAttribute("data-size")).toBe("metadata");
    const unresolved = review.querySelector('[data-resolution="unresolved"]');
    const resolved = review.querySelector('[data-resolution="resolved"]');
    expect(unresolved?.textContent).toBe("3");
    expect(unresolved?.querySelector('[data-icon="MessageSquare"]')).toBeTruthy();
    expect(resolved?.textContent).toBe("4");
    expect(resolved?.querySelector('[data-icon="Check"]')).toBeTruthy();
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

  it("uses aligned icons for both stack disclosure states", () => {
    const { rerender } = render(
      <ChangesStackBranchRow
        branch={stackBranch()}
        expanded={false}
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    const collapsed = screen.getByRole("button", {
      name: "Show changed files for pull request #8",
    });
    expect(collapsed.querySelector("svg path")?.getAttribute("d")).toBe(
      "m9 18 6-6-6-6",
    );

    rerender(
      <ChangesStackBranchRow
        branch={stackBranch()}
        expanded
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );
    const expanded = screen.getByRole("button", {
      name: "Hide changed files for pull request #8",
    });
    expect(expanded.querySelector("svg path")?.getAttribute("d")).toBe(
      "m6 9 6 6 6-6",
    );
  });

  it("uses the shared accessible line-delta presentation in summaries and file columns", () => {
    render(
      <ChangesStackBranchRow
        branch={stackBranch({
          diff: {
            additions: 1241,
            deletions: 134,
            files: [
              {
                path: "src/short.ts",
                previousPath: null,
                status: "modified",
                additions: 1,
                deletions: 23,
              },
              {
                path: "src/four-digits.ts",
                previousPath: null,
                status: "added",
                additions: 1234,
                deletions: 4,
              },
            ],
            truncated: false,
          },
        })}
        expanded
        checkingOut={false}
        onToggle={() => undefined}
        onCheckout={() => undefined}
      />,
    );

    const additions = screen.getAllByLabelText(/lines? added$/);
    const deletions = screen.getAllByLabelText(/lines? deleted$/);
    expect(additions.map((count) => count.textContent)).toEqual([
      "+1241",
      "+1",
      "+1234",
    ]);
    expect(deletions.map((count) => count.textContent)).toEqual([
      "−134",
      "−23",
      "−4",
    ]);
    expect(
      additions.every((count) => count.classList.contains("ws-line-delta-additions")),
    ).toBe(true);
    expect(
      deletions.every((count) => count.classList.contains("ws-line-delta-deletions")),
    ).toBe(true);
    expect(
      additions
        .filter((count) => count.classList.contains("ws-file-additions"))
        .map((count) => count.textContent),
    ).toEqual(["+1", "+1234"]);
    expect(
      deletions
        .filter((count) => count.classList.contains("ws-file-deletions"))
        .map((count) => count.textContent),
    ).toEqual(["−23", "−4"]);
    const summaryDeltas = document.querySelector(".ws-stack-line-deltas");
    const toggle = screen.getByRole("button", {
      name: /#8 A very long pull request title/,
    });
    expect(summaryDeltas?.parentElement).toBe(toggle);
    expect(toggle.querySelector("small .ws-stack-line-deltas")).toBeNull();
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
    dispatchHrefClickWithoutJsdomNavigation(
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
