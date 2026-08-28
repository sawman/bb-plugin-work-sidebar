import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../views.css", import.meta.url), "utf8");

describe("Status card layout", () => {
  it("gives collapsed Agent and User activity two lines and removes the clamp when expanded", () => {
    expect(css).toMatch(
      /\.ws-status-card \.ws-activity-(?:copy|command)[\s\S]*?-webkit-line-clamp:\s*2;/,
    );
    expect(css).toMatch(
      /\.ws-status-card \.ws-activity-item-expanded[\s\S]*?-webkit-line-clamp:\s*unset;/,
    );
  });
});
