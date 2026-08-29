import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../..");
const featureSources = [
  "features/tasks/thread-assignment-picker.tsx",
  "features/pull-requests/reviewer-picker.tsx",
  "features/tracker/views.tsx",
  "features/work-context/views.tsx",
  "features/threads/thread-hierarchy-picker.tsx",
];

function source(path: string) {
  return readFileSync(resolve(root, path), "utf8");
}

describe("R35 shared search shell architecture", () => {
  it("rejects feature-owned compact search and combobox contracts", () => {
    const violations = featureSources.flatMap((path) => {
      const content = source(path);
      return [
        /type=["']search["']/.test(content) ? `${path}: type=search` : null,
        /role=["']combobox["']/.test(content) ? `${path}: role=combobox` : null,
        /aria-expanded=["']true["']/.test(content)
          ? `${path}: literal aria-expanded=true`
          : null,
      ].filter((violation): violation is string => violation !== null);
    });
    expect(violations).toEqual([]);
  });

  it("routes every R35 consumer through the plugin-local shell", () => {
    expect(source("components/ui/sidebar-search.tsx")).toContain("SearchCombobox");
    for (const path of featureSources)
      expect(source(path), path).toContain("SearchCombobox");
  });
});
