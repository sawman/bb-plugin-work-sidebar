import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(fileURLToPath(new URL("../../..", import.meta.url)));

describe("tracker legacy removal", () => {
  it("has no retained LinearCard component or app import path", () => {
    expect(existsSync(resolve(root, "components/work/linear-card.tsx"))).toBe(false);
    expect(readFileSync(resolve(root, "app.tsx"), "utf8")).not.toMatch(/LinearCard|components\/work\/linear-card/);
  });
});
