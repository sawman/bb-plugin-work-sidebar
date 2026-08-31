import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const threadsRoot = resolve(process.cwd(), "features/threads");

function source(name: string) {
  return readFileSync(resolve(threadsRoot, name), "utf8");
}

describe("Threads settings composition architecture", () => {
  it("keeps the numeric editor in a feature-local lifecycle module", () => {
    expect(existsSync(resolve(threadsRoot, "settings-editor.tsx"))).toBe(true);
    expect(source("settings-editor.tsx")).toMatch(
      /export function NumericAutosaveEditor/,
    );
    expect(source("sidebar-appearance-settings.tsx")).not.toMatch(
      /function NumericAppearanceEditor/,
    );
  });

  it("keeps appearance composition bounded and row descriptors singular", () => {
    const appearance = source("sidebar-appearance-settings.tsx");
    expect(appearance.split("\n").length).toBeLessThanOrEqual(280);
    expect(appearance.match(/label: "Row height"/g)).toHaveLength(1);
    expect(appearance.match(/label: "Text scale"/g)).toHaveLength(1);
  });
});
