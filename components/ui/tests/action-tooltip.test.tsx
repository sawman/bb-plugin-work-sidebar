// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  ActionTooltip,
  MAX_TOOLTIP_LABEL_LENGTH,
} from "../action-tooltip";

afterEach(cleanup);

describe("ActionTooltip", () => {
  it("keeps tooltip labels within the shared compact-copy budget", () => {
    const label = "A deliberately verbose tooltip label that must be shortened for compact controls";
    render(
      <ActionTooltip label={label}>
        {(tooltipId) => <button aria-describedby={tooltipId}>Control</button>}
      </ActionTooltip>,
    );

    const tooltip = screen.getByRole("tooltip");
    const rendered = tooltip.getAttribute("aria-label") ?? "";
    expect(rendered.length).toBeLessThanOrEqual(MAX_TOOLTIP_LABEL_LENGTH);
    expect(rendered).toMatch(/…$/);
    expect(tooltip.getAttribute("data-tooltip-label")).toBe(rendered);
  });
});
