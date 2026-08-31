import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

type Rule = {
  selector: string;
  properties: string[];
  line: number;
  atRules: string[];
};

const stylesheetPath = join(import.meta.dirname, "../../views.css");

function withoutComments(source: string) {
  return source.replace(/\/\*[\s\S]*?\*\//g, (comment) =>
    comment.replace(/[^\n]/g, " "),
  );
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
    if (character === '"' || character === "'") quote = character;
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed CSS block at line ${lineNumber(source, openIndex)}`);
}

function normalize(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function declarationProperties(source: string, start: number, end: number) {
  const properties: string[] = [];
  let segmentStart = start;
  let parentheses = 0;
  let quote: '"' | "'" | null = null;

  const readSegment = (segmentEnd: number) => {
    const segment = source.slice(segmentStart, segmentEnd);
    const colon = segment.indexOf(":");
    if (colon >= 0) {
      const property = normalize(segment.slice(0, colon));
      if (/^[-\w]+$/.test(property)) properties.push(property);
    }
    segmentStart = segmentEnd + 1;
  };

  for (let index = start; index < end; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    if (character === "(") parentheses += 1;
    if (character === ")") parentheses -= 1;
    if (character === ";" && parentheses === 0) readSegment(index);
  }
  readSegment(end);
  return properties;
}

function parseRules(source: string) {
  const clean = withoutComments(source);
  const rules: Rule[] = [];

  const parseRange = (start: number, end: number, atRules: string[]) => {
    let cursor = start;
    while (cursor < end) {
      const open = clean.indexOf("{", cursor);
      if (open < 0 || open >= end) return;
      const close = matchingClose(clean, open);
      const prelude = normalize(clean.slice(cursor, open));
      if (prelude.startsWith("@")) {
        parseRange(open + 1, close, [...atRules, prelude]);
      } else if (prelude) {
        rules.push({
          selector: prelude,
          properties: declarationProperties(clean, open + 1, close),
          line: lineNumber(clean, cursor),
          atRules,
        });
      }
      cursor = close + 1;
    }
  };

  parseRange(0, clean.length, []);
  return rules;
}

function ruleKey(rule: Pick<Rule, "atRules" | "selector">) {
  return JSON.stringify([...rule.atRules, rule.selector]);
}

function conflictingRepeatedProperties(rules: Rule[]) {
  const byCascade = new Map<string, Rule[]>();
  for (const rule of rules)
    byCascade.set(ruleKey(rule), [...(byCascade.get(ruleKey(rule)) ?? []), rule]);

  return [...byCascade.values()].flatMap((matchingRules) => {
    if (matchingRules.length < 2) return [];
    const propertyOwners = new Map<string, number[]>();
    for (const rule of matchingRules)
      for (const property of new Set(rule.properties))
        propertyOwners.set(property, [
          ...(propertyOwners.get(property) ?? []),
          rule.line,
        ]);

    const overlaps = [...propertyOwners.entries()]
      .filter(([, lines]) => lines.length > 1)
      .map(([property, lines]) => ({ property, lines }));
    return overlaps.length
      ? [{ selector: matchingRules[0]!.selector, atRules: matchingRules[0]!.atRules, overlaps }]
      : [];
  });
}

describe("stylesheet duplicate ownership", () => {
  test("distinguishes cascade contexts while detecting real declaration conflicts", () => {
    const rules = parseRules(`
      .same { color: red; }
      .same { color: blue; }
      .disjoint { color: red; }
      .disjoint { display: grid; }
      @media (max-width: 320px) {
        .same { color: green; }
        .media-conflict { gap: 1px; }
        .media-conflict { gap: 2px; }
      }
    `);

    expect(
      conflictingRepeatedProperties(rules).map(
        ({ selector, atRules, overlaps }) => ({
          selector,
          atRules,
          properties: overlaps.map(({ property }) => property),
        }),
      ),
    ).toEqual([
      { selector: ".same", atRules: [], properties: ["color"] },
      {
        selector: ".media-conflict",
        atRules: ["@media (max-width: 320px)"],
        properties: ["gap"],
      },
    ]);
  });

  test("keeps production rules free of empty blocks and same-cascade conflicts", () => {
    const rules = parseRules(readFileSync(stylesheetPath, "utf8"));
    expect(
      rules.filter(({ properties }) => properties.length === 0),
      "remove empty rules",
    ).toEqual([]);
    expect(
      conflictingRepeatedProperties(rules),
      "merge repeated selectors that own the same property in one cascade",
    ).toEqual([]);
  });
});
