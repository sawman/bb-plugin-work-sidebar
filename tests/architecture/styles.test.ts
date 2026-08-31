import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";

const repositoryRoot = join(import.meta.dirname, "../..");

function stylesheetPaths() {
  return readdirSync(repositoryRoot)
    .filter((name) => name.endsWith(".css"))
    .map((name) => join(repositoryRoot, name))
    .sort();
}

function stylesheetStructureErrors(path: string, source: string) {
  const errors: string[] = [];
  let braces = 0;
  let parentheses = 0;
  let quote: '"' | "'" | null = null;
  let inComment = false;

  for (const [lineIndex, line] of source.split("\n").entries()) {
    if (line.length > 240)
      errors.push(`${relative(repositoryRoot, path)}:${lineIndex + 1}: line exceeds 240 characters`);

    for (let index = 0; index < line.length; index += 1) {
      const character = line[index];
      const next = line[index + 1];
      if (inComment) {
        if (character === "*" && next === "/") {
          inComment = false;
          index += 1;
        }
        continue;
      }
      if (!quote && character === "/" && next === "*") {
        inComment = true;
        index += 1;
        continue;
      }
      if (quote) {
        if (character === quote && line[index - 1] !== "\\") quote = null;
        continue;
      }
      if (character === '"' || character === "'") quote = character;
      if (character === "{") braces += 1;
      if (character === "}") braces -= 1;
      if (character === "(") parentheses += 1;
      if (character === ")") parentheses -= 1;
      if (braces < 0 || parentheses < 0)
        errors.push(`${relative(repositoryRoot, path)}:${lineIndex + 1}: unexpected closing token`);
    }
  }

  if (braces !== 0) errors.push(`${relative(repositoryRoot, path)}: unbalanced braces`);
  if (parentheses !== 0)
    errors.push(`${relative(repositoryRoot, path)}: unbalanced parentheses`);
  if (quote) errors.push(`${relative(repositoryRoot, path)}: unterminated string`);
  if (inComment)
    errors.push(`${relative(repositoryRoot, path)}: unterminated comment`);
  return errors;
}

function undocumentedImportantDeclarations(path: string, source: string) {
  const violations: string[] = [];
  let documented = false;
  for (const [lineIndex, line] of source.split("\n").entries()) {
    const trimmed = line.trim();
    if (/^\/\* R17 important: .+ \*\/$/.test(trimmed)) {
      documented = true;
      continue;
    }
    if (!trimmed || /^\/\*.*\*\/$/.test(trimmed)) continue;
    if (line.includes("!important") && !documented)
      violations.push(`${relative(repositoryRoot, path)}:${lineIndex + 1}`);
    documented = false;
  }
  return violations;
}

describe("stylesheet policy", () => {
  test("keeps every plugin stylesheet structurally valid and diffable", () => {
    const errors = stylesheetPaths().flatMap((path) =>
      stylesheetStructureErrors(path, readFileSync(path, "utf8")),
    );
    expect(errors).toEqual([]);
  });

  test("uses host theme tokens instead of reset or hardcoded palette debt", () => {
    for (const path of stylesheetPaths()) {
      const source = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(source, relative(repositoryRoot, path)).not.toMatch(
        /\ball\s*:\s*unset\b/,
      );
      expect(source, relative(repositoryRoot, path)).not.toMatch(
        /#[0-9a-f]{3,8}\b/i,
      );
    }
  });

  test("documents every host-specific important override at the declaration", () => {
    const violations = stylesheetPaths().flatMap((path) =>
      undocumentedImportantDeclarations(path, readFileSync(path, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  test("reserves a uniform card heading row for optional metadata", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const heading = source.match(/\.ws-card-heading\s*\{([\s\S]*?)\}/)?.[1];
    const info = source.match(/\.ws-card-heading-info\s*\{([\s\S]*?)\}/)?.[1];

    expect(heading).toContain("min-height: 1.6rem");
    expect(info).toContain("min-height: 1.6rem");
  });

  test("keeps working-provider animation modes visible and motion-safe", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const sheenStart = source.indexOf(".ws-thread-provider-fallback-shine");
    const animationStart = source.indexOf(
      "@keyframes ws-thread-provider-shine",
    );
    const animationEnd = source.indexOf(
      "@media (prefers-reduced-motion: reduce)",
      animationStart,
    );
    const sheen = source.slice(sheenStart, animationStart);
    const animation = source.slice(animationStart, animationEnd);

    expect(sheenStart).toBeGreaterThanOrEqual(0);
    expect(animationStart).toBeGreaterThanOrEqual(0);
    expect(animationEnd).toBeGreaterThan(animationStart);
    expect(sheen).toContain("var(--primary-foreground)");
    expect(source).toContain('data-working-provider-animation="slow-spin"');
    expect(source).toContain('data-working-provider-animation="fast-spin"');
    expect(source).toContain('data-working-provider-animation="sheen"');
    expect(source).toContain('data-working-provider-animation="pulse"');
    expect(source).toMatch(
      /animation:\s*ws-thread-provider-shine\s+[\d.]+s\s+linear\s+infinite/,
    );
    expect(source).toMatch(
      /animation:\s*ws-thread-provider-spin\s+3\.2s\s+linear\s+infinite/,
    );
    expect(source).toMatch(
      /animation:\s*ws-thread-provider-spin\s+1s\s+linear\s+infinite/,
    );
    expect(animation).toContain("clip-path:");
    expect(animation).not.toContain("mask-position:");
    expect(animation).not.toMatch(/\b(?:filter|opacity)\s*:/);
    expect(source).toContain("@media (prefers-reduced-motion: reduce)");
  });
});
