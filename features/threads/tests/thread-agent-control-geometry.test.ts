import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../../views.css", import.meta.url), "utf8");

function declarations(selector: string): Record<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const body = source.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`))?.[1];
  expect(body, selector).toBeDefined();
  return Object.fromEntries(
    body!.replace(/\/\*[\s\S]*?\*\//g, "").split(";").filter((entry) => entry.includes(":"))
      .map((entry) => entry.trim().split(/:\s*/)),
  );
}

function rem(value: string) {
  expect(value).toMatch(/^-?[\d.]+(?:rem)?$/);
  return Number.parseFloat(value);
}

function edges(value: string) {
  const parts = value.split(/\s+/).map(rem);
  const [top, right = top, bottom = top, left = right] = parts;
  return { top, right, bottom, left };
}

describe("thread agent control style geometry budget", () => {
  // This checks the plugin's layout contract, not host-rendered glyph bounds.
  // Root's live light/dark acceptance verifies actual paint and font metrics.
  it("centres provider and count together with symmetric horizontal space", () => {
    const control = declarations(".ws-thread-agent-control");
    const padding = edges(control.padding);
    expect(control["justify-items"]).toBe("center");
    expect(padding.left).toBe(padding.right);
    // Retain the original horizontal footprint for single/double/capped counts.
    expect(rem(control["min-width"]) + padding.left + padding.right).toBeCloseTo(1.22);
    const counter = declarations(".ws-thread-agent-control small");
    expect(counter["min-width"]).toBe("2ch");
    expect(counter["text-align"]).toBe("center");
    const capped = declarations('.ws-thread-agent-control small[data-saturated="true"]');
    expect(capped["transform-origin"]).toBe("center");
  });

  it("contains the bounce with breathing room while preserving the row footprint", () => {
    const control = declarations(".ws-thread-agent-control");
    const padding = edges(control.padding);
    const margin = edges(control.margin);
    const bounce = source.match(/@keyframes ws-thread-provider-bounce\s*\{[\s\S]*?translateY\((-?[\d.]+rem)\)/);
    expect(bounce).toBeTruthy();
    const travel = Math.abs(rem(bounce![1]));
    expect(padding.top).toBe(padding.bottom);
    // At least 0.04rem remains beyond the full animation travel on either side.
    expect(padding.top - travel).toBeGreaterThanOrEqual(0.04);
    const tracks = control["grid-template-rows"].split(/\s+/).map(rem);
    const contentHeight = Math.max(
      rem(control["min-height"]),
      tracks.reduce((total, track) => total + track, 0) + rem(control["row-gap"]),
    );
    const paintedHeight = contentHeight + padding.top + padding.bottom;
    const footprint = paintedHeight + margin.top + margin.bottom;
    expect(footprint).toBeCloseTo(1.62); // previous control's outer height
    const leading = declarations(".ws-thread-leading");
    expect(footprint).toBeLessThanOrEqual(rem(leading["min-height"]));
    const row = declarations(".ws-sidebar-row");
    const rowHeight = rem(leading["min-height"]) + 2 * rem(row["padding-block"]);
    expect(paintedHeight).toBeLessThan(rowHeight);
    for (const selector of [".ws-thread-agent-control", ".ws-thread-leading", ".ws-thread-anchor", ".ws-thread"]) {
      expect(declarations(selector).overflow ?? "visible").not.toMatch(/hidden|clip/);
    }
  });
});
