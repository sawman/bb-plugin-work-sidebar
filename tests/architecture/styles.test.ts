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

function stripComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findStyleDebt(source: string) {
  const debt: string[] = [];
  const sourceWithoutComments = stripComments(source);
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of sourceWithoutComments.matchAll(rulePattern)) {
    const selector = match[1].trim().replace(/\s+/g, " ");
    const declarations = match[2];
    if (/all\s*:\s*unset\b/.test(declarations)) {
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
      let parentheses = 0;
      let quote: '"' | "'" | null = null;
      let inComment = false;
      for (const [index, line] of source.split("\n").entries()) {
        if (line.length > 240) {
          longLines.push(`${relative}:${index + 1} (${line.length} chars)`);
        }
        for (let offset = 0; offset < line.length; offset += 1) {
          const character = line[offset];
          const next = line[offset + 1];
          if (inComment) {
            if (character === "*" && next === "/") {
              inComment = false;
              offset += 1;
            }
            continue;
          }
          if (!quote && character === "/" && next === "*") {
            inComment = true;
            offset += 1;
            continue;
          }
          if (quote) {
            if (character === quote && line[offset - 1] !== "\\") quote = null;
            continue;
          }
          if (character === '"' || character === "'") {
            quote = character;
          } else if (character === "{") {
            depth += 1;
          } else if (character === "}") {
            depth -= 1;
            if (depth < 0) parseErrors.push(`${relative}:${index + 1}: unexpected closing brace`);
          } else if (character === "(") {
            parentheses += 1;
          } else if (character === ")") {
            parentheses -= 1;
            if (parentheses < 0) parseErrors.push(`${relative}:${index + 1}: unexpected closing parenthesis`);
          }
        }
      }
      if (depth !== 0) parseErrors.push(`${relative}: unbalanced braces (${depth})`);
      if (parentheses !== 0) parseErrors.push(`${relative}: unbalanced parentheses (${parentheses})`);
      if (inComment) parseErrors.push(`${relative}: unterminated comment`);
      if (quote) parseErrors.push(`${relative}: unterminated string`);
      debt.push(...findStyleDebt(source).map((entry) => `${relative}: ${entry}`));
    }

    expect(parseErrors, `CSS parse errors:\n${parseErrors.join("\n")}`).toEqual([]);
    expect(longLines, `CSS physical lines over 240 chars:\n${longLines.join("\n")}`).toEqual([]);
    expect(debt).toMatchSnapshot("existing selector debt");
  });
});
