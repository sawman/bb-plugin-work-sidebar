import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "../..");

function stylesheetPaths() {
  return readdirSync(root)
    .filter((name) => name.endsWith(".css"))
    .map((name) => join(root, name))
    .sort();
}

function findStyleDebt(source: string) {
  const debt: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of source.matchAll(rulePattern)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const declarations = match[2];
    if (declarations.includes("all:unset")) {
      debt.push(`${selector}: all: unset`);
    }
    for (const palette of declarations.matchAll(/#[0-9a-f]{3,8}\b/gi)) {
      debt.push(`${selector}: hardcoded palette ${palette[0]}`);
    }
    if (declarations.includes("!important")) {
      debt.push(`${selector}: undocumented !important`);
    }
  }
  return debt;
}

describe("stylesheet architecture baseline", () => {
  test("every plugin stylesheet parses, stays diffable, and has recorded debt", () => {
    const debt: string[] = [];
    const parseErrors: string[] = [];
    const longLines: string[] = [];

    for (const file of stylesheetPaths()) {
      const source = readFileSync(file, "utf8");
      const relative = file.slice(root.length + 1);
      let depth = 0;
      for (const [index, line] of source.split("\n").entries()) {
        if (line.length > 240) {
          longLines.push(`${relative}:${index + 1} (${line.length} chars)`);
        }
        for (const character of line) {
          if (character === "{") depth += 1;
          if (character === "}") depth -= 1;
          if (depth < 0) parseErrors.push(`${relative}:${index + 1}: unexpected closing brace`);
        }
      }
      if (depth !== 0) parseErrors.push(`${relative}: unbalanced braces (${depth})`);
      debt.push(...findStyleDebt(source).map((entry) => `${relative}: ${entry}`));
    }

    expect(parseErrors, `CSS parse errors:\n${parseErrors.join("\n")}`).toEqual([]);
    expect(longLines, `CSS physical lines over 240 chars:\n${longLines.join("\n")}`).toEqual([]);
    expect(debt).toMatchSnapshot("existing selector debt");
  });
});
