// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ActionTooltip,
  fitTooltipPosition,
  MAX_TOOLTIP_LABEL_LENGTH,
} from "../action-tooltip";

afterEach(cleanup);

describe("ActionTooltip", () => {
  it("fits top-edge and right-edge tooltips within the viewport", () => {
    expect(
      fitTooltipPosition(
        { left: 94, top: 2, width: 8, height: 12, bottom: 14 },
        { width: 48, height: 20 },
        { width: 100, height: 100 },
      ),
    ).toEqual({ left: 44, top: 19 });
  });

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

  it("measures its trigger instead of relying on an ancestor's layout", async () => {
    const view = render(
      <ActionTooltip label="Open">
        {(tooltipId) => <button aria-describedby={tooltipId}>Control</button>}
      </ActionTooltip>,
    );
    const anchor = view.container.querySelector<HTMLElement>(".ws-action-tooltip")!;
    const tooltip = screen.getByRole("tooltip");
    vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue({
      left: 94, top: 2, width: 8, height: 12, bottom: 14,
    } as DOMRect);
    vi.spyOn(tooltip, "getBoundingClientRect").mockReturnValue({
      width: 48, height: 20,
    } as DOMRect);
    Object.defineProperty(window, "innerWidth", { configurable: true, value: 100 });
    Object.defineProperty(window, "innerHeight", { configurable: true, value: 100 });
    fireEvent.pointerEnter(anchor);
    await waitFor(() => {
      expect((tooltip as HTMLElement).style.left).toBe("44px");
      expect((tooltip as HTMLElement).style.top).toBe("19px");
      expect(tooltip.getAttribute("data-open")).toBe("true");
    });
  });
});
