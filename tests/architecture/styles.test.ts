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
    const workItemGoalBadge = source.match(
      /\.ws-work-item-current-goal-badge\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(heading).toContain("min-height: 0.84rem");
    expect(info).toContain("min-height: 0.84rem");
    expect(workItemGoalBadge).toContain("min-height: 0.84rem");
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

  test("keeps explicit thread-popup settings rows primitive-owned, centered, aligned, and singly separated", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const rows = source.match(
      /\.ws-settings-row\[data-layout="thread-popup"\]\s*\{([\s\S]*?)\}/,
    )?.[1];
    const groups = source.match(
      /\.ws-thread-group-settings\s*\{([\s\S]*?)\}/,
    )?.[1];
    const toolbar = source.match(
      /\.ws-work-toolbar-actions\s*\{([\s\S]*?)\}/,
    )?.[1];
    const search = source.match(/\.ws-sidebar-search\s*\{([\s\S]*?)\}/)?.[1];

    expect(rows).toContain("display: grid");
    expect(rows).toContain("align-items: center");
    expect(rows).toContain("grid-template-columns: minmax(0, 1fr) 4.2rem");
    expect(rows).toContain("font: var(--ws-text-subtext)");
    expect(rows).toContain("border-top: 0");
    expect(source).not.toMatch(
      /\.ws-thread-appearance-settings\s+\.ws-settings-row/,
    );
    expect(source).toMatch(
      /\.ws-settings-label\s*\{[\s\S]*?color: var\(--foreground\);[\s\S]*?font: var\(--ws-text-label\);/,
    );
    expect(groups).toContain("border-top: 1px solid var(--border)");
    expect(toolbar).toContain("flex-wrap: wrap");
    expect(search).toContain("display: inline-flex");
    expect(search).toContain("flex: none");
  });

  test("keeps every thread-location presentation in one shrinkable inline flow", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const location = source.match(
      /\.ws-thread-meta \.ws-thread-location\s*\{([\s\S]*?)\}/,
    )?.[1];
    const tooltip = source.match(
      /\.ws-thread-location > \.ws-action-tooltip\s*\{([\s\S]*?)\}/,
    )?.[1];
    const content = source.match(
      /\.ws-thread-location-content\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(location).toContain("display: inline-flex");
    expect(location).toContain("flex: 0 1 auto");
    expect(tooltip).toContain("display: inline-flex");
    expect(tooltip).toContain("flex: 0 1 auto");
    expect(content).toContain("display: inline-flex");
    expect(content).toContain("white-space: nowrap");
    expect(content).toContain("overflow: hidden");
  });

  test("keeps the right-pane refresh action as a borderless tabbar icon", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const tooltip = source.match(
      /\.ws-panel-tabbar > \.ws-action-tooltip\s*\{([\s\S]*?)\}/,
    )?.[1];
    const refresh = source.match(
      /\.ws-panel-tabbar \.ws-refresh-button\s*\{([\s\S]*?)\}/,
    )?.[1];

    expect(tooltip).toContain("display: grid");
    expect(tooltip).not.toContain("border");
    expect(refresh).toContain("border: 0");
    expect(refresh).toContain("border-radius: 0");
  });

  test("keeps left Task titles and child disclosures shrinkable and single-line", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const row = source.match(/\.ws-task-row\s*\{([\s\S]*?)\}/)?.[1];
    const main = source.match(
      /\.ws-task-row > \.ws-sidebar-row-main\s*\{([\s\S]*?)\}/,
    )?.[1];
    const title = source.match(/\.ws-task-title\s*\{([\s\S]*?)\}/)?.[1];
    const line = source.match(/\.ws-task-title-line\s*\{([\s\S]*?)\}/)?.[1];
    const tooltip = source.match(
      /\.ws-task-title-line > \.ws-action-tooltip\s*\{([\s\S]*?)\}/,
    )?.[1];
    const picker = source.match(/\.ws-task-thread-picker\s*\{([\s\S]*?)\}/)?.[1];
    const chip = source.match(/\.ws-task-thread-chip\s*\{([\s\S]*?)\}/)?.[1];

    expect(title).toContain("overflow: hidden");
    expect(title).toContain("text-overflow: ellipsis");
    expect(title).toContain("white-space: nowrap");
    expect(row).toContain("grid-template-columns: minmax(0, 1fr) auto");
    expect(row).toContain("align-items: center");
    expect(main).toContain("overflow: hidden");
    expect(line).toContain("min-width: 0");
    expect(tooltip).toContain("min-width: 0");
    expect(tooltip).toContain("flex: 1 1 auto");
    const assign = source.match(/\.ws-task-assign\s*\{([\s\S]*?)\}/)?.[1];
    expect(assign).toContain("display: block");
    expect(assign).toContain("width: 100%");
    expect(assign).toContain("overflow: hidden");
    expect(picker).toContain("width: 0");
    expect(picker).toContain("flex: 1 1 5rem");
    expect(chip).toContain("width: 100%");
  });

  test("keeps plugin tooltips flat instead of adding a bright underglow", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    for (const [selector, body] of [
      [
        ".ws-action-tooltip-content",
        source.match(/\.ws-action-tooltip-content\s*\{([\s\S]*?)\}/)?.[1],
      ],
      [
        ".ws-pr-thread-tooltip",
        source.match(/\.ws-pr-thread-tooltip\s*\{([\s\S]*?)\}/)?.[1],
      ],
      [
        ".ws-pr-tooltip::after",
        source.match(/\.ws-pr-tooltip::after\s*\{([\s\S]*?)\}/)?.[1],
      ],
    ] as const) {
      expect(body, selector).toBeDefined();
      expect(body, selector).not.toContain("box-shadow");
    }
  });
});
