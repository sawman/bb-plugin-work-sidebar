import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../../../views.css", import.meta.url), "utf8");

describe("Agents status icon presentation", () => {
  it("colors every state, animates active states, and disables motion when requested", () => {
    for (const state of ["working", "waiting", "blocked", "complete", "idle"])
      expect(css).toContain(`.ws-agent-state-${state}`);
    expect(css).toMatch(/\.ws-agent-state-working\s*\{[^}]*animation:/s);
    expect(css).toMatch(/@keyframes\s+ws-agent-working-bounce/);
    expect(css).toMatch(/\.ws-agent-state-waiting\s*\{[^}]*animation:/s);
    expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*\.ws-agent-state/s);
  });

  it("lays out explicit agent actions above the live duration", () => {
    expect(css).toMatch(/\.ws-agent-actions\s*\{[^}]*display:\s*grid/s);
    expect(css).toMatch(/\.ws-agent-action-buttons\s*\{[^}]*display:\s*flex/s);
    expect(css).toContain(".ws-agent-duration");
  });
});
