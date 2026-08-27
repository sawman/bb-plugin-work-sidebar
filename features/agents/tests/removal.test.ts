import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("R15 Agents removal boundary", () => {
  it("keeps the legacy Agents implementation out of the Work composition entry", () => {
    const source = readFileSync(new URL("../../../app.tsx", import.meta.url), "utf8");
    expect(source).not.toContain("WorkAgentRow");
    expect(source).not.toContain("context.children");
    expect(source).not.toContain("agentProjectionState");
  });
});
