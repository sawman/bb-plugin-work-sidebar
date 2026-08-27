import { readFileSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join, relative } from "node:path";
import * as ts from "typescript";
import { describe, expect, test } from "vitest";
import { productionSourcePaths } from "./production-source-paths.js";

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

function stylesheetSelectors(source: string) {
  return stylesheetRules(source).map(({ selector }) => selector);
}

function stylesheetRules(source: string) {
  return [...stripComments(source).matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((match) => ({ selector: match[1].trim().replace(/\s+/g, " "), declarations: match[2] }));
}

function undocumentedImportantDeclarations(source: string): string[] {
  const violations: string[] = [];
  let hasDeclarationComment = false;
  for (const [index, line] of source.split("\n").entries()) {
    const trimmed = line.trim();
    if (/^\/\* R17 important: .+ \*\/$/.test(trimmed)) {
      hasDeclarationComment = true;
      continue;
    }
    if (!trimmed || /^\/\*.*\*\/$/.test(trimmed)) continue;
    if (line.includes("!important")) {
      if (!hasDeclarationComment)
        violations.push(`${index + 1}: ${trimmed}`);
      hasDeclarationComment = false;
      continue;
    }
    hasDeclarationComment = false;
  }
  return violations;
}

const dynamicClassFamilies = [
  { prefix: "ws-agent-state-", file: "features/agents/views.tsx", suffixes: ["working", "waiting", "blocked", "complete", "idle"] },
  { prefix: "ws-file-", file: "features/changes/views.tsx", suffixes: ["added", "deleted", "modified", "renamed", "untracked"] },
  { prefix: "ws-github-api-", file: "features/changes/panel.tsx", suffixes: ["available", "rate_limited", "unavailable"] },
  { prefix: "ws-plan-", file: "features/work-context/views.tsx", suffixes: ["completed", "in_progress", "pending"] },
  { prefix: "ws-provider-health-", file: "features/work-context/views.tsx", suffixes: ["green", "amber", "red"] },
  { prefix: "ws-status-dot-", file: "features/work-context/views.tsx", suffixes: ["in_progress", "running", "done"] },
  { prefix: "ws-task-priority-", file: "features/tasks/task-row.tsx", suffixes: ["urgent", "high", "medium", "low"] },
  { prefix: "ws-task-row-", file: "features/tasks/task-row.tsx", suffixes: ["outcome", "execution"] },
  { prefix: "ws-task-status-", file: "features/tasks/task-row.tsx", suffixes: ["backlog", "todo", "in_progress", "in_review", "done", "canceled"] },
  { prefix: "ws-thread-child-depth-", file: "features/threads/thread-row.tsx", suffixes: ["1", "2", "3", "4"] },
] as const;

function scriptKind(path: string) {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function classAttributeTokens(path: string, source: string) {
  const tokens = new Set<string>();
  const templatePrefixes = new Set<string>();
  const sourceFile = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, scriptKind(path));
  const collectText = (text: string) => {
    for (const token of text.match(/ws-[A-Za-z0-9_-]+/g) ?? []) tokens.add(token);
  };
  const visitClassValue = (node: ts.Node) => {
    if (ts.isStringLiteralLike(node)) collectText(node.text);
    if (ts.isTemplateExpression(node)) {
      const literalParts = [node.head.text, ...node.templateSpans.map((span) => span.literal.text)];
      for (const part of literalParts) {
        collectText(part);
        for (const { prefix } of dynamicClassFamilies) {
          if (part.includes(prefix)) templatePrefixes.add(prefix);
        }
      }
    }
    ts.forEachChild(node, visitClassValue);
  };
  const visit = (node: ts.Node) => {
    if (ts.isJsxAttribute(node) && ts.isIdentifier(node.name) && (node.name.text === "className" || node.name.text === "class") && node.initializer) {
      visitClassValue(node.initializer);
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return { tokens, templatePrefixes };
}

function sourceClassConsumers() {
  const sourceByPath = new Map(productionSourcePaths().map((file) => [relative(root, file), readFileSync(file, "utf8")]));
  const staticClasses = new Set(
    [...sourceByPath.entries()].flatMap(([path, source]) => [...classAttributeTokens(path, source).tokens]),
  );
  const dynamicFamilies = dynamicClassFamilies.filter(({ prefix, file }) => {
    const source = sourceByPath.get(file);
    return source ? classAttributeTokens(file, source).templatePrefixes.has(prefix) : false;
  });
  return { staticClasses, dynamicFamilies };
}

function selectorClassNames(selector: string) {
  return [...selector.matchAll(/\.((?:ws-[A-Za-z0-9_-]+))/g)].map((match) => match[1]);
}

function hasProductionConsumer(className: string, consumers: ReturnType<typeof sourceClassConsumers>) {
  return consumers.staticClasses.has(className) || consumers.dynamicFamilies.some(({ prefix, suffixes }) =>
    suffixes.some((suffix) => className === `${prefix}${suffix}`),
  );
}

function directSurfacePrimitivePaths() {
  const violations: string[] = [];
  for (const file of productionSourcePaths().filter((path) => path.endsWith(".tsx") && relative(root, path) !== "components/ui/surface-card.tsx")) {
    const sourceFile = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node: ts.Node) => {
      if (ts.isJsxOpeningElement(node) && ["article", "div"].includes(node.tagName.getText())) {
        const className = node.attributes.properties.find((attribute): attribute is ts.JsxAttribute =>
          ts.isJsxAttribute(attribute) && attribute.name.getText() === "className",
        );
        const tokens = new Set(className?.initializer?.getText().match(/ws-[A-Za-z0-9_-]+/g) ?? []);
        if ((node.tagName.getText() === "article" && tokens.has("ws-card")) || (node.tagName.getText() === "div" && tokens.has("ws-card-heading"))) {
          violations.push(relative(root, file) + ":" + (sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1));
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  return violations;
}

function jsxAttributeNames(attributes: ts.JsxAttributes) {
  return new Set(attributes.properties.filter(ts.isJsxAttribute).map((attribute) => attribute.name.getText()));
}

function buttonHasVisibleText(children: ts.NodeArray<ts.JsxChild>) {
  let visibleText = false;
  const visit = (child: ts.Node) => {
    if (ts.isJsxText(child) && /[A-Za-z0-9]/.test(child.text)) visibleText = true;
    if (ts.isStringLiteralLike(child) && /[A-Za-z0-9]/.test(child.text)) visibleText = true;
    if (ts.isJsxElement(child) || ts.isJsxFragment(child)) child.children.forEach(visit);
    if (ts.isJsxExpression(child) && child.expression) ts.forEachChild(child.expression, visit);
  };
  children.forEach(visit);
  return visibleText;
}

function buttonHasIconOrGlyph(node: ts.JsxElement) {
  let iconOrGlyph = false;
  const visit = (child: ts.Node) => {
    if (ts.isJsxText(child) && /[^\sA-Za-z0-9]/.test(child.text)) iconOrGlyph = true;
    if (ts.isJsxSelfClosingElement(child) && /^(?:Icon|svg)$/.test(child.tagName.getText())) iconOrGlyph = true;
    if (ts.isJsxElement(child)) {
      if (/^(?:Icon|svg)$/.test(child.openingElement.tagName.getText())) iconOrGlyph = true;
      child.children.forEach(visit);
    }
    if (ts.isJsxFragment(child)) child.children.forEach(visit);
    if (ts.isJsxExpression(child) && child.expression) ts.forEachChild(child.expression, visit);
  };
  node.children.forEach(visit);
  return iconOrGlyph;
}

function undocumentedIconButtons(sourceFile: ts.SourceFile) {
  const undocumented: string[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText() === "button") {
      const attributes = jsxAttributeNames(node.openingElement.attributes);
      if (buttonHasIconOrGlyph(node) && !buttonHasVisibleText(node.children) && !attributes.has("aria-label") && !attributes.has("aria-labelledby")) {
        undocumented.push(`${sourceFile.fileName}:${sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1}`);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return undocumented;
}

describe("stylesheet architecture baseline", () => {
  test("every plugin stylesheet parses and stays diffable", () => {
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
    }

    expect(parseErrors, `CSS parse errors:\n${parseErrors.join("\n")}`).toEqual([]);
    expect(longLines, `CSS physical lines over 240 chars:\n${longLines.join("\n")}`).toEqual([]);
  });
});

describe("shared surface and list-row architecture", () => {
  test("associates each important declaration with its immediately preceding R17 comment", () => {
    expect(undocumentedImportantDeclarations(`
      /* R17 important: a former blanket comment. */
      color: inherit;
      background: var(--accent) !important;
    `)).toEqual(["4: background: var(--accent) !important;"]);
    expect(undocumentedImportantDeclarations(`
      /* R17 important: host styling overrides this background. */
      background: var(--accent) !important;
    `)).toEqual([]);
  });

  test("finds every static class in multi-class and template JSX attributes", () => {
    const fixture = classAttributeTokens("fixture.tsx", `
      const fixture = <article className="ws-card ws-empty-state-card">
        <span className={\`ws-card-note \${busy ? "ws-card-note-busy" : ""}\`} />
      </article>;
    `);

    expect(fixture.tokens).toEqual(new Set(["ws-card", "ws-empty-state-card", "ws-card-note", "ws-card-note-busy"]));
  });

  test("limits dynamic template consumers to their evidenced class families", () => {
    const consumers = sourceClassConsumers();

    expect(hasProductionConsumer("ws-file-modified", consumers)).toBe(true);
    expect(hasProductionConsumer("ws-file-list", consumers)).toBe(consumers.staticClasses.has("ws-file-list"));
    expect(hasProductionConsumer("ws-file-legacy", consumers)).toBe(false);
  });

  test("keeps one consumed surface contract and no broad primitive typography overrides", () => {
    const rules = stylesheetPaths().flatMap((file) => stylesheetRules(readFileSync(file, "utf8")));
    const competingContracts = rules
      .filter(({ selector }) => /\.ws-(?:surface|work-card)(?:[.:#\s,{]|$)/.test(selector))
      .map(({ selector }) => selector);
    const cardContractDefinitions = rules.filter(({ selector }) => selector === ".ws-card").map(({ selector }) => selector);
    const cardHeadingDefinitions = rules.filter(({ selector }) => selector === ".ws-card-heading").map(({ selector }) => selector);
    const cardHeadingStrongDefinitions = rules.filter(({ selector }) => selector === ".ws-card-heading strong").map(({ selector }) => selector);
    const cardControlFocus = rules.find(({ selector }) => selector === ".ws-card :is(button, input, select):focus-visible");
    const broadTypography = rules
      .filter(({ selector, declarations }) =>
        /\.ws-(?:card|surface|work-card)\s+(?:h[1-6]|p|small|strong|\*\b)/.test(selector)
        || (selector.includes(".ws-card-heading") && ![".ws-card-heading", ".ws-card-heading strong"].includes(selector) && /\b(?:font(?:-size|-weight)?|line-height|letter-spacing)\s*:/.test(declarations)),
      )
      .map(({ selector }) => selector);

    expect(competingContracts, "only the shared .ws-card surface contract may own card layout").toEqual([]);
    expect(cardContractDefinitions, "the shared card contract is defined once across plugin stylesheets").toEqual([".ws-card"]);
    expect(cardHeadingDefinitions, "the shared card heading contract is defined once across plugin stylesheets").toEqual([".ws-card-heading"]);
    expect(cardHeadingStrongDefinitions, "only the heading primitive owns its strong typography").toEqual([".ws-card-heading strong"]);
    expect(cardControlFocus?.declarations, "shared card controls retain an explicit visible focus treatment").toContain("outline: 2px solid var(--ring)");
    expect(broadTypography, "surface selectors must not override descendant typography").toEqual([]);
  });

  test("keeps settings group row selectors aligned with the semantic dialog markup", () => {
    const rules = stylesheetPaths().flatMap((file) => stylesheetRules(readFileSync(file, "utf8")));
    const row = rules.find(({ selector }) => selector === ".ws-thread-group-settings > div");
    const title = rules.find(({ selector }) => selector === ".ws-thread-group-settings > div > button:first-child");

    expect(row?.declarations).toContain("grid-template-columns: minmax(0, 1fr) 1.55rem");
    expect(title?.declarations).toContain("text-overflow: ellipsis");
  });

  test("keeps the settings dialog below and above the sticky toolbar", () => {
    const rules = stylesheetPaths().flatMap((file) => stylesheetRules(readFileSync(file, "utf8")));
    const menuDeclarations = rules
      .filter(({ selector }) => selector === ".ws-thread-settings-menu")
      .map(({ declarations }) => declarations)
      .join("\n");
    const toolbarDeclarations = rules
      .filter(({ selector }) => selector === ".ws-list-toolbar")
      .map(({ declarations }) => declarations)
      .join("\n");
    const settingsDeclarations = rules
      .filter(({ selector }) => selector === ".ws-thread-settings")
      .map(({ declarations }) => declarations)
      .join("\n");

    expect(menuDeclarations).toContain("top: calc(100% + 0.2rem) !important");
    expect(menuDeclarations).toContain("bottom: auto !important");
    expect(menuDeclarations).toContain("z-index: 100 !important");
    expect(toolbarDeclarations).toContain("z-index: 40");
    expect(toolbarDeclarations).toContain("isolation: isolate");
    expect(settingsDeclarations).toContain("z-index: 41");
  });

  test("constructs card roots and headings only through the shared primitive", () => {
    expect(directSurfacePrimitivePaths()).toEqual([]);
  });

  test("removes unsupported style debt rather than snapshotting it", () => {
    const selectors = stylesheetPaths().flatMap((file) => stylesheetSelectors(readFileSync(file, "utf8")));
    const source = stylesheetPaths().map((file) => readFileSync(file, "utf8")).join("\n");
    const consumers = sourceClassConsumers();
    const obsolete = [...new Set(selectors.flatMap(selector => selectorClassNames(selector)))]
      .filter((className) => !hasProductionConsumer(className, consumers));

    expect(source).not.toMatch(/\ball\s*:\s*unset\b/);
    expect(source).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    const importantRules = stylesheetPaths().flatMap((file) => {
      const source = readFileSync(file, "utf8");
      return [...source.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
        .filter((match) => match[2]?.includes("!important"))
        .map((match) => ({
          selector: stripComments(match[1]!).trim().replace(/\s+/g, " "),
          declarations: match[2]!,
          file,
        }));
    });

    const undocumentedImportant = stylesheetPaths().flatMap((file) =>
      undocumentedImportantDeclarations(readFileSync(file, "utf8"))
        .map((violation) => `${relative(root, file)}: ${violation}`),
    );

    expect(undocumentedImportant, "every important declaration directly documents its host override reason").toEqual([]);
    expect(importantRules.every(({ selector }) => selectorClassNames(selector).every((className) => hasProductionConsumer(className, consumers))), "important overrides must retain production consumers").toBe(true);
    expect(obsolete, "every ws-* selector must retain a production consumer").toEqual([]);
  });

  test("keeps icon-only controls accessible", () => {
    const fixture = ts.createSourceFile("fixture.tsx", `
      const controls = <>
        <button><Icon name="X" /></button>
        <button>Close</button>
        <button aria-label="Close"><Icon name="X" /></button>
      </>;
    `, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    expect(undocumentedIconButtons(fixture)).toEqual(["fixture.tsx:3"]);
    const undocumented = productionSourcePaths(root).flatMap((file) => undocumentedIconButtons(
      ts.createSourceFile(relative(root, file), readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, scriptKind(file)),
    ));
    expect(undocumented).toEqual([]);
  });
});
