import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("R15 Agents removal boundary", () => {
  it("keeps the legacy Agents implementation out of the Work composition entry", () => {
    const appSource = readFileSync(new URL("../../../app.tsx", import.meta.url), "utf8");
    const modelSource = readFileSync(new URL("../../../work-model.ts", import.meta.url), "utf8");
    expect(appSource).not.toContain("WorkAgentRow");
    expect(appSource).not.toContain("context.children");
    expect(appSource).not.toContain("agentProjectionState");
    expect(modelSource).not.toContain("agentProjectionState");
  });
});
