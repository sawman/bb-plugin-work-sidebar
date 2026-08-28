import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

const root = join(import.meta.dirname, "../..");
const stylesheetPath = join(root, "views.css");

type Declaration = {
  property: string;
  value: string;
  important: boolean;
  line: number;
};

type Rule = {
  selector: string;
  declarations: Declaration[];
  line: number;
  atRules: string[];
};

type DuplicateInventoryItem = {
  selector: string;
  lines: number[];
  overlappingProperties: string[];
};

const RED_DEAD_SELECTORS = [
  ".ws-status",
  ".ws-thread-child-depth-1, .ws-thread-child-depth-2, .ws-thread-child-depth-3, .ws-thread-child-depth-4",
  ".ws-section-count",
  ".ws-card-note",
  ".ws-stack-rail",
  ".ws-stack-layer",
  ".ws-agent-card small",
  ".ws-agent-card",
  ".ws-agent-card strong",
  ".ws-agent-state-waiting",
  ".ws-agent-state-idle",
  ".ws-thread",
  ".ws-thread > .ws-thread-anchor",
  ".ws-thread > .ws-thread-anchor.ws-thread-has-children",
  ".ws-thread-dragging > .ws-thread-anchor",
  ".ws-task-meta",
  ".ws-task-key-badge, .ws-task-badge",
  ".ws-task-status-picker",
  ".ws-task-status-picker svg",
  ".ws-task-status-picker:hover:not(:disabled)",
  ".ws-pr-row",
  ".ws-pr-changes_requested",
  ".ws-pr-stack-disclosure",
  ".ws-pr-stack-disclosure[data-state=\"open\"]",
  ".ws-pr-stack-disclosure:hover",
  ".ws-pr-stack-layer-item",
  ".ws-pr-stack-layer-item .ws-pr-row",
  ".ws-pr-target",
  ".ws-pr-stack-layer-item::before",
  ".ws-pr-stack-layer-item > .ws-pr-row",
  ".ws-new-thread",
  ".ws-current-pr-summary",
  ".ws-thread-settings-menu",
  ".ws-thread-task-card",
] as const;

// These selectors looked state-specific in the RED review, but were still
// same-cascade duplicates. They remain in the RED inventory and are not an
// exemption from the zero-overlap gate.
const STATE_SHAPED_RED_SELECTORS = [
  ".ws-thread-dragging > .ws-thread-anchor",
  ".ws-task-status-picker:hover:not(:disabled)",
  ".ws-pr-changes_requested",
  ".ws-pr-stack-disclosure[data-state=\"open\"]",
  ".ws-pr-stack-disclosure:hover",
] as const;

// These exact selectors intentionally remain split because each repeated rule
// owns disjoint declarations; the overlap gate below still inspects every one.
const EXPECTED_DISJOINT_REPEATED_SELECTORS = [
  ".ws-thread-child-depth-1, .ws-thread-child-depth-2, .ws-thread-child-depth-3, .ws-thread-child-depth-4",
  ".ws-section-count",
  ".ws-callout button",
  ".ws-stack-layer",
  ".ws-agent-card small",
  ".ws-agent-card",
  ".ws-agent-card > span:nth-child(2)",
  ".ws-agent-card strong",
  ".ws-thread",
  ".ws-thread > .ws-thread-anchor",
  ".ws-thread > .ws-rename",
  ".ws-thread-trailing",
  ".ws-task-meta",
  ".ws-task-key-badge, .ws-task-badge",
  ".ws-task-status-picker",
  ".ws-pr-row",
  ".ws-pr-stack",
  ".ws-pr-stack-disclosure",
  ".ws-pr-stack-layer-item",
  ".ws-pr-stack-layer-item .ws-pr-row",
  ".ws-pr-target",
  ".ws-work-toolbar-actions",
  ".ws-thread-settings",
] as const;

const EXPECTED_EFFECTIVE_STYLES: Record<string, Record<string, string>> = {
  ".ws-status": {
    width: "auto",
    "min-width": "0.8rem",
    "font-size": "0.58rem",
    position: "relative",
    display: "inline-grid",
    "grid-auto-flow": "column",
    "column-gap": "0.08rem",
    "place-items": "center",
    height: "0.8rem",
    color: "var(--muted-foreground)",
    "line-height": "1",
  },
  ".ws-thread-child-depth-1, .ws-thread-child-depth-2, .ws-thread-child-depth-3, .ws-thread-child-depth-4": {
    "border-left": "1px solid var(--border)",
    "margin-left": "0.38rem",
    "padding-left": "0.24rem",
  },
  ".ws-section-count": {
    color: "var(--muted-foreground)",
    "font-size": "0.58rem",
  },
  ".ws-card-note": {
    margin: "0",
    color: "var(--muted-foreground)",
    "font-size": "0.64rem",
    "line-height": "1.35",
  },
  ".ws-stack-rail": {
    display: "grid",
    gap: "0.08rem",
    margin: "0",
    padding: "0",
    "list-style": "none",
  },
  ".ws-stack-layer": {
    "grid-template-columns": "0.8rem minmax(0, 1fr) auto",
    "align-items": "center",
    "min-width": "0",
    "border-radius": "calc(var(--radius) - 3px)",
    padding: "0.38rem 0.28rem !important",
    display: "grid",
    width: "100%",
    gap: "0.32rem",
    border: "0 !important",
    background: "transparent",
    color: "inherit",
    "text-align": "left",
  },
  ".ws-agent-card small": {
    color: "var(--muted-foreground)",
    "font-size": "0.6rem",
    "line-height": "1.2",
  },
  ".ws-agent-card": {
    "grid-template-columns": "0.8rem minmax(0, 1fr) auto",
    "align-items": "start",
    "min-width": "0",
    padding: "0.42rem 0.18rem",
    gap: "0.34rem",
    "border-width": "0 0 1px",
    "border-radius": "0",
    background: "transparent",
    display: "grid",
    width: "100%",
  },
  ".ws-agent-card strong": {
    overflow: "hidden",
    "font-size": "0.7rem",
    "text-overflow": "ellipsis",
    "white-space": "nowrap",
    "line-height": "1.2",
  },
  ".ws-agent-state-waiting": {
    color: "var(--primary)",
    animation: "ws-agent-waiting-bob 1.6s ease-in-out infinite",
  },
  ".ws-agent-state-idle": {
    color: "var(--muted-foreground)",
  },
  ".ws-thread": {
    display: "grid",
    "grid-template-columns": "minmax(0, 1fr)",
    "align-items": "center",
    cursor: "grab",
  },
  ".ws-thread > .ws-thread-anchor": {
    "grid-column": "2",
    "grid-row": "1",
    display: "grid",
    "grid-template-columns": "0.8rem minmax(0, 1fr) auto",
    width: "100%",
    "padding-left": "0",
  },
  ".ws-thread > .ws-thread-anchor.ws-thread-has-children": {
    "padding-left": "0",
  },
  ".ws-thread-dragging > .ws-thread-anchor": {
    background: "var(--accent)",
  },
  ".ws-task-meta": {
    display: "flex",
    "flex-wrap": "wrap",
    gap: "0.2rem",
    color: "var(--muted-foreground)",
    "font-size": "0.59rem",
    "align-items": "center",
  },
  ".ws-task-key-badge, .ws-task-badge": {
    border: "1px solid var(--border)",
    "border-radius": "999px",
    padding: "0.03rem 0.22rem",
    "white-space": "nowrap",
    display: "inline-flex",
    "align-items": "center",
    gap: "0.14rem",
    "min-height": "1rem",
    "box-sizing": "border-box",
    "font-size": "0.54rem",
    "line-height": "1",
  },
  ".ws-task-status-picker": {
    display: "inline-flex",
    "min-height": "1rem",
    "align-items": "center",
    "justify-content": "center",
    gap: "0.22rem",
    border: "0",
    "border-radius": "2px",
    padding: "0",
    background: "transparent",
    font: "inherit",
    "font-size": "0.62rem",
    "font-weight": "650",
    "line-height": "1.15",
    "white-space": "nowrap",
    cursor: "pointer",
    position: "relative",
    width: "1rem",
    "min-width": "1rem",
    height: "1rem",
  },
  ".ws-task-status-picker svg": {
    width: "0.62rem",
    height: "0.62rem",
  },
  ".ws-task-status-picker:hover:not(:disabled)": {
    background: "var(--accent)",
  },
  ".ws-pr-row": {
    position: "relative",
    "border-radius": "calc(var(--radius) - 2px)",
    display: "grid",
    "grid-template-columns": "var(--ws-pr-stack-gutter) minmax(0, 1fr) auto",
    gap: "0.18rem",
    "align-items": "center",
    "min-height": "2.35rem",
    padding: "0.35rem 0.45rem",
    "border-bottom": "1px solid var(--border)",
    "padding-left": "0",
  },
  ".ws-pr-changes_requested": {
    color: "var(--destructive)",
  },
  ".ws-pr-stack-disclosure": {
    display: "inline-flex",
    width: "0.8rem",
    height: "1.15rem",
    "align-items": "center",
    "justify-content": "center",
    flex: "none",
    border: "0",
    "border-radius": "calc(var(--radius) - 3px)",
    background: "transparent",
    color: "var(--muted-foreground)",
    cursor: "pointer",
    padding: "0",
    "font-size": "0.68rem",
    "line-height": "1",
    transition: "transform 0.12s ease",
  },
  ".ws-pr-stack-disclosure[data-state=\"open\"]": {
    transform: "rotate(90deg)",
    background: "transparent",
    color: "var(--foreground)",
  },
  ".ws-pr-stack-disclosure:hover": {
    color: "var(--foreground)",
    background: "var(--accent)",
    "border-radius": "calc(var(--radius) - 3px)",
  },
  ".ws-pr-stack-layer-item": {
    "min-width": "0",
    "padding-left": "0 !important",
    position: "relative",
    "margin-left": "0 !important",
    "border-left": "0",
    background: "none",
  },
  ".ws-pr-stack-layer-item .ws-pr-row": {
    "padding-left": "0",
    "border-bottom": "0",
  },
  ".ws-pr-target": {
    display: "grid",
    "grid-template-columns": "minmax(0, 1fr)",
    "grid-template-areas": "\"title\" \"context\"",
    "grid-template-rows": "auto auto",
    "min-width": "0",
    gap: "0.08rem",
    color: "inherit",
    "text-decoration": "none",
  },
  ".ws-pr-stack-layer-item::before": {
    position: "absolute",
    top: "0",
    bottom: "0",
    left: "calc(var(--ws-pr-row-inline-padding) + (var(--ws-pr-stack-gutter) - 1px) / 2 - 1px) !important",
    width: "1px",
    background: "color-mix(in srgb, var(--primary) 72%, var(--border))",
    content: "\"\"",
  },
  ".ws-pr-stack-layer-item > .ws-pr-row": {
    "margin-left": "0 !important",
    background: "linear-gradient( 90deg, color-mix(in srgb, var(--primary) 6%, transparent), transparent 36% )",
    "padding-left": "0 !important",
  },
  ".ws-new-thread": {
    display: "inline-flex !important",
    width: "1.6rem !important",
    height: "1.6rem !important",
    "align-items": "center",
    "justify-content": "center",
    margin: "0 !important",
    padding: "0 !important",
    border: "1px solid transparent !important",
    "border-radius": "calc(var(--radius) - 3px) !important",
    color: "var(--muted-foreground) !important",
  },
  ".ws-new-thread svg": {
    width: "0.76rem",
    height: "0.76rem",
    display: "block",
    margin: "0",
  },
  ".ws-current-pr-summary": {
    display: "grid",
    "grid-template-columns": "0.75rem minmax(0, 1fr) auto",
    width: "100%",
    "align-items": "center",
    gap: "0.35rem",
    padding: "0.45rem 3.25rem 0.45rem 0.45rem",
  },
  ".ws-thread-settings-menu": {
    position: "absolute",
    "z-index": "100 !important",
    right: "0",
    top: "calc(100% + 0.2rem) !important",
    display: "grid",
    "min-width": "10.5rem",
    padding: "0.18rem",
    border: "1px solid var(--border)",
    "border-radius": "var(--radius)",
    background: "var(--popover)",
    "box-shadow": "0 8px 24px color-mix(in srgb, var(--foreground) 18%, transparent)",
    bottom: "auto !important",
  },
  ".ws-thread-task-card": {
    display: "grid",
    gap: "0.38rem",
    padding: "0.58rem",
  },
};

function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
}

function lineNumber(source: string, index: number) {
  return source.slice(0, index).split("\n").length;
}

function matchingClose(source: string, openIndex: number) {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let index = openIndex; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed CSS block at ${lineNumber(source, openIndex)}`);
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function parseDeclarations(source: string, start: number, end: number): Declaration[] {
  const declarations: Declaration[] = [];
  let segmentStart = start;
  let parentheses = 0;
  let quote: '"' | "'" | null = null;
  const segments: Array<[number, number]> = [];

  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "(") {
      parentheses += 1;
    } else if (character === ")") {
      parentheses -= 1;
    } else if (character === ";" && parentheses === 0) {
      segments.push([segmentStart, index]);
      segmentStart = index + 1;
    }
  }
  segments.push([segmentStart, end]);

  for (const [segmentStartIndex, segmentEnd] of segments) {
    const segment = source.slice(segmentStartIndex, segmentEnd);
    const colon = segment.indexOf(":");
    if (colon < 0) continue;
    const property = normalizeWhitespace(segment.slice(0, colon));
    if (!/^[-\w]+$/.test(property)) continue;
    let value = normalizeWhitespace(segment.slice(colon + 1));
    const important = /\s*!important$/.test(value);
    if (important) value = value.replace(/\s*!important$/, " !important");
    declarations.push({ property, value, important, line: lineNumber(source, segmentStartIndex) });
  }
  return declarations;
}

function parseRules(source: string): Rule[] {
  const clean = withoutComments(source);
  const rules: Rule[] = [];

  function parseRange(start: number, end: number, atRules: string[]) {
    let cursor = start;
    while (cursor < end) {
      const open = clean.indexOf("{", cursor);
      if (open < 0 || open >= end) return;
      const close = matchingClose(clean, open);
      if (close > end) throw new Error(`CSS block escapes its parent at ${lineNumber(clean, open)}`);
      const prelude = normalizeWhitespace(clean.slice(cursor, open));
      if (prelude.startsWith("@")) {
        parseRange(open + 1, close, [...atRules, prelude]);
      } else if (prelude.startsWith(".")) {
        rules.push({
          selector: prelude,
          declarations: parseDeclarations(clean, open + 1, close),
          line: lineNumber(clean, cursor),
          atRules,
        });
      }
      cursor = close + 1;
    }
  }

  parseRange(0, clean.length, []);
  return rules;
}

function ruleKey({ atRules, selector }: Pick<Rule, "atRules" | "selector">) {
  return JSON.stringify([...atRules, selector]);
}

function effectiveDeclarations(rules: Rule[], selector: string, atRules: string[] = []) {
  const effective = new Map<string, Declaration>();
  const key = ruleKey({ atRules, selector });
  for (const rule of rules.filter((candidate) => ruleKey(candidate) === key)) {
    for (const declaration of rule.declarations) {
      const previous = effective.get(declaration.property);
      if (!previous || declaration.important || !previous.important) effective.set(declaration.property, declaration);
    }
  }
  return Object.fromEntries([...effective.entries()].map(([property, declaration]) => [property, declaration.value]));
}

function overlappingProperties(rules: Rule[]) {
  const byCascade = new Map<string, Rule[]>();
  for (const rule of rules) {
    const key = ruleKey(rule);
    byCascade.set(key, [...(byCascade.get(key) ?? []), rule]);
  }
  const duplicates: DuplicateInventoryItem[] = [];

  for (const selectorRules of byCascade.values()) {
    if (selectorRules.length < 2) continue;
    const properties = new Set<string>();
    for (let first = 0; first < selectorRules.length; first += 1) {
      const firstProperties = selectorRules[first]!.declarations.map(({ property }) => property);
      for (let second = first + 1; second < selectorRules.length; second += 1) {
        const secondProperties = new Set(selectorRules[second]!.declarations.map(({ property }) => property));
        for (const property of firstProperties) if (secondProperties.has(property)) properties.add(property);
      }
    }
    if (properties.size === 0) continue;
    duplicates.push({
      selector: selectorRules[0]!.selector,
      lines: selectorRules.map(({ line }) => line),
      overlappingProperties: [...properties].sort(),
    });
  }
  return duplicates;
}

function repeatedExactSelectors(rules: Rule[]) {
  const counts = new Map<string, { count: number; selector: string }>();
  for (const rule of rules) {
    const key = ruleKey(rule);
    const count = counts.get(key);
    counts.set(key, { count: (count?.count ?? 0) + 1, selector: rule.selector });
  }
  return [...counts.values()]
    .filter(({ count }) => count > 1)
    .map(({ selector }) => selector);
}

function emptyRules(rules: Rule[]) {
  return rules.filter(({ declarations }) => declarations.length === 0).map(({ selector, line }) => ({ selector, line }));
}

describe("protected stylesheet duplicate ownership", () => {
  test("records class rules nested in at-rules for ownership checks", () => {
    expect(parseRules("@media (min-width: 1px) { .ws-at-rule-only { color: red; } }")).toEqual([
      {
        selector: ".ws-at-rule-only",
        declarations: [
          {
            property: "color",
            value: "red",
            important: false,
            line: 1,
          },
        ],
        line: 1,
        atRules: ["@media (min-width: 1px)"],
      },
    ]);
  });

  test("keeps top-level and at-rule stack toggle gaps in separate cascades", () => {
    const media = "@media (max-width: 320px)";
    const rules = parseRules(`
      .ws-stack-layer-toggle { gap: 0.05rem; }
      @media (max-width: 320px) {
        .ws-stack-layer-toggle { gap: 0.02rem; }
      }
    `);

    expect({
      topLevel: effectiveDeclarations(rules, ".ws-stack-layer-toggle"),
      media: effectiveDeclarations(rules, ".ws-stack-layer-toggle", [media]),
      overlaps: overlappingProperties(rules),
      repeated: repeatedExactSelectors(rules),
    }).toEqual({
      topLevel: { gap: "0.05rem" },
      media: { gap: "0.02rem" },
      overlaps: [],
      repeated: [],
    });
  });

  test("allows an expected disjoint repeat in a separate at-rule cascade", () => {
    const selector = ".ws-pr-stack-disclosure";
    const rules = parseRules(`
      .ws-pr-stack-disclosure { display: grid; }
      .ws-pr-stack-disclosure { gap: 0.25rem; }
      @media (max-width: 320px) {
        .ws-pr-stack-disclosure { scroll-margin-top: 2px; }
      }
    `);

    expect(EXPECTED_DISJOINT_REPEATED_SELECTORS).toContain(selector);
    expect(repeatedExactSelectors(rules), "media-only rules must not enter the top-level repeated-selector inventory").toEqual([selector]);
    expect(overlappingProperties(rules), "a media-only declaration must not create a top-level duplicate-property overlap").toEqual([]);
    expect(effectiveDeclarations(rules, selector), "top-level effective declarations must exclude media-only properties").toEqual({
      display: "grid",
      gap: "0.25rem",
    });
  });

  test("preserves the exact RED inventory and effective declarations", () => {
    const rules = parseRules(readFileSync(stylesheetPath, "utf8"));
    const inventory = overlappingProperties(rules);

    expect(RED_DEAD_SELECTORS).toHaveLength(34);
    expect(STATE_SHAPED_RED_SELECTORS.every((selector) => RED_DEAD_SELECTORS.includes(selector))).toBe(true);
    expect(inventory, "all RED same-cascade overlaps must be consolidated").toEqual([]);
    expect(emptyRules(rules), "empty CSS rules must be removed").toEqual([]);

    for (const selector of RED_DEAD_SELECTORS) {
      expect(effectiveDeclarations(rules, selector), selector).toEqual(EXPECTED_EFFECTIVE_STYLES[selector]);
    }

    const repeated = repeatedExactSelectors(rules);
    expect(repeated).toEqual([...EXPECTED_DISJOINT_REPEATED_SELECTORS]);
  });

  test("requires zero overlapping properties across repeated exact selectors", () => {
    const inventory = overlappingProperties(parseRules(readFileSync(stylesheetPath, "utf8")));
    expect(inventory.map(({ selector }) => selector), "repeated exact selectors must not overlap").toEqual([]);
  });
});
