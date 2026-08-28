// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { TaskPriorityIcon } from "../priority";

afterEach(cleanup);

describe("task priority icon", () => {
  it.each([
    ["urgent", "Urgent priority", 0],
    ["high", "High priority", 3],
    ["medium", "Medium priority", 2],
    ["low", "Low priority", 1],
  ] as const)("presents %s priority descriptively", (priority, label, activeBars) => {
    render(<TaskPriorityIcon priority={priority} />);

    const icon = screen.getByRole("img", { name: label });
    expect(icon.getAttribute("data-priority")).toBe(priority);
    expect(icon.getAttribute("title")).toBe(label);
    expect(icon.querySelectorAll('[data-priority-bar="active"]')).toHaveLength(
      activeBars,
    );
  });

  it("omits the no-priority state", () => {
    const view = render(<TaskPriorityIcon priority="none" />);
    expect(view.container.childElementCount).toBe(0);
  });
});
