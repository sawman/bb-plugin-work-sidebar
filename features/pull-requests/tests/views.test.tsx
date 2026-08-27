// @vitest-environment jsdom
import { createElement } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PullRequestChangesError } from "../views";

describe("R5 pull-request error presentation", () => {
  it("renders an accessible Changes failure and retries only the PR query", () => {
    const retry = vi.fn();
    render(createElement(PullRequestChangesError, { error: new Error("GitHub unavailable"), onRetry: retry }));
    expect(screen.getByRole("alert").textContent).toContain("Could not load pull request changes");
    expect(screen.getByRole("alert").textContent).toContain("GitHub unavailable");
    fireEvent.click(screen.getByRole("button", { name: "Retry pull request changes" }));
    expect(retry).toHaveBeenCalledOnce();
  });
});
