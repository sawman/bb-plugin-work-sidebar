// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { changesHeaderLabel } from "../model";
import { ChangesError, ChangesStackBranchRow } from "../views";

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

  it("keeps a zero-file stack label focusable without exposing a disclosure", () => {
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
    const label = screen.getByRole("button", { name: "#8 Empty" });
    expect(label.getAttribute("aria-disabled")).toBe("true");
    expect(label.hasAttribute("aria-expanded")).toBe(false);
    expect(label.getAttribute("aria-label")).not.toContain(
      "Show changed files",
    );
    expect(label.querySelector(".ws-stack-expand")).toBeNull();
  });
});
