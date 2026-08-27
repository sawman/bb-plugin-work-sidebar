// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { changesHeaderLabel } from "../model";
import { ChangesError } from "../views";

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
});
