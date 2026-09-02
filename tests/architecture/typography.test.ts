import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import {
  MINIMUM_TEXT_ROLE_SIZE_REM,
  MIN_ACCESSIBLE_TEXT_SIZE_PX,
  MIN_TEXT_SCALE,
} from "../../features/threads/sidebar-appearance";

const repositoryRoot = join(import.meta.dirname, "../..");
const typographyRoles = [
  "primary",
  "title",
  "subtext",
  "metadata",
  "label",
  "code",
] as const;

type TypographyRole = (typeof typographyRoles)[number];

// R37 RED characterization: these were every distinct shipped raw size/weight
// value at ee49c61. Each raw value maps only to the six semantic roles below.
const legacySizeRoles: Record<string, readonly TypographyRole[]> = {
  "0.48rem": ["label"],
  "0.5rem": ["metadata"],
  "0.52rem": ["metadata"],
  "0.53rem": ["metadata"],
  "0.54rem": ["metadata"],
  "0.55rem": ["metadata"],
  "0.56rem": ["subtext"],
  "0.57rem": ["subtext"],
  "0.58rem": ["label", "code"],
  "0.59rem": ["metadata"],
  "0.6rem": ["subtext"],
  "0.61rem": ["metadata"],
  "0.62rem": ["metadata"],
  "0.64rem": ["subtext"],
  "0.65rem": ["subtext"],
  "0.66rem": ["subtext"],
  "0.67rem": ["subtext"],
  "0.68rem": ["subtext"],
  "0.7rem": ["primary"],
  "0.72rem": ["title"],
  "0.74rem": ["primary"],
  "0.78rem": ["primary"],
  "0.8rem": ["primary"],
  "0.85rem": ["title"],
  "0.9rem": ["label"],
};

const legacyWeightRoles: Record<string, readonly TypographyRole[]> = {
  "400": ["primary", "subtext", "metadata", "code"],
  "500": ["subtext"],
  "600": ["label"],
  "650": ["title"],
  "700": ["title"],
};

function stylesheetPaths() {
  const paths: string[] = [];
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (![".git", "dist", "node_modules"].includes(entry.name)) visit(join(directory, entry.name));
      } else if (entry.name.endsWith(".css")) {
        paths.push(join(directory, entry.name));
      }
    }
  };
  visit(repositoryRoot);
  return paths.sort();
}

function typographyTokenBlock(source: string) {
  const match = source.match(
    /\/\* R37 typography token block: start \*\/([\s\S]*?)\/\* R37 typography token block: end \*\//,
  );
  return match?.[1] ?? "";
}

function typographyDeclarationViolations(path: string, source: string) {
  const tokenBlock = typographyTokenBlock(source);
  const outsideTokenBlock =
    relative(repositoryRoot, path) === "views.css" && tokenBlock
      ? source.replace(tokenBlock, "")
      : source;
  return [...outsideTokenBlock.matchAll(/\bfont-(?:size|weight)\s*:/g)].map(
    (match) => `${relative(repositoryRoot, path)}:${match.index}`,
  );
}

describe("semantic typography architecture", () => {
  test("records every legacy raw type value under exactly six semantic roles", () => {
    expect(Object.keys(legacySizeRoles)).toEqual([
      "0.48rem",
      "0.5rem",
      "0.52rem",
      "0.53rem",
      "0.54rem",
      "0.55rem",
      "0.56rem",
      "0.57rem",
      "0.58rem",
      "0.59rem",
      "0.6rem",
      "0.61rem",
      "0.62rem",
      "0.64rem",
      "0.65rem",
      "0.66rem",
      "0.67rem",
      "0.68rem",
      "0.7rem",
      "0.72rem",
      "0.74rem",
      "0.78rem",
      "0.8rem",
      "0.85rem",
      "0.9rem",
    ]);
    expect(Object.keys(legacyWeightRoles)).toEqual(["400", "500", "600", "650", "700"]);
    expect(
      new Set([...Object.values(legacySizeRoles), ...Object.values(legacyWeightRoles)].flat()),
    ).toEqual(new Set(typographyRoles));
  });

  test("allows font size and weight declarations only in the designated token block", () => {
    const violations = stylesheetPaths().flatMap((path) =>
      typographyDeclarationViolations(path, readFileSync(path, "utf8")),
    );
    expect(violations).toEqual([]);
  });

  test("defines exactly six host-token role pairs from one root scale", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const tokenBlock = typographyTokenBlock(source);
    expect(
      stylesheetPaths().filter((path) => typographyTokenBlock(readFileSync(path, "utf8"))),
    ).toEqual([join(repositoryRoot, "views.css")]);
    expect(tokenBlock).toContain("--ws-text-scale: 1;");

    const tokenPairs = [...tokenBlock.matchAll(/--ws-text-([a-z]+)-(size|weight)\s*:/g)].map(
      ([, role, property]) => `${role}:${property}`,
    );
    expect(tokenPairs).toEqual(
      typographyRoles.flatMap((role) => [`${role}:size`, `${role}:weight`]),
    );

    for (const role of typographyRoles) {
      expect(tokenBlock).toMatch(
        new RegExp(`--ws-text-${role}-size: calc\\([^;]*var\\(--ws-text-scale\\)`),
      );
      expect(tokenBlock).toMatch(
        new RegExp(`--ws-text-${role}-weight: var\\(--font-weight-`),
      );
    }
  });

  test("re-resolves derived tokens in every sidebar and portal scale scope", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const tokenBlock = typographyTokenBlock(source);
    const scope = tokenBlock.match(
      /:root\s*,\s*:where\(([^)]*)\)\s*\{([\s\S]*?)\n\s*\}/,
    );

    expect(scope?.[1].split(",").map((selector) => selector.trim())).toEqual([
      ".ws-list",
      ".ws-panel",
      ".ws-context-menu",
      '.ws-search-shell-content[data-portalled="true"]',
    ]);
    expect(scope?.[2]).toContain("--ws-text-scale: 1;");
    for (const role of typographyRoles) {
      expect(scope?.[2]).toContain(`--ws-text-${role}-size:`);
      expect(scope?.[2]).toContain(`--ws-text-${role}:`);
    }
  });

  test("keeps the smallest scaled role above the accessibility floor", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    const tokenBlock = typographyTokenBlock(source);
    expect(tokenBlock).toContain(
      `--ws-text-label-size: calc(${MINIMUM_TEXT_ROLE_SIZE_REM}rem * var(--ws-text-scale))`,
    );
    expect(MIN_TEXT_SCALE * MINIMUM_TEXT_ROLE_SIZE_REM * 16).toBeGreaterThanOrEqual(
      MIN_ACCESSIBLE_TEXT_SIZE_PX,
    );
  });

  test("applies every semantic role through its token instead of a raw type declaration", () => {
    const roleUses = stylesheetPaths().flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/font:\s*var\(--ws-text-([a-z]+)\)/g)].map(
        ([, role]) => role,
      ),
    );
    expect(new Set(roleUses)).toEqual(new Set(typographyRoles));
  });

  test("preserves each rule's existing line-height when applying a type role", () => {
    const missingLineHeight = stylesheetPaths().flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/([^{}]+)\{([^{}]*)\}/g)].flatMap(
        ([, selector, declarations]) =>
          /font:\s*var\(--ws-text-/.test(declarations) && !/line-height\s*:/.test(declarations)
            ? [`${relative(repositoryRoot, path)}:${selector.trim()}`]
            : [],
      ),
    );
    expect(missingLineHeight).toEqual([]);
  });

  test("uses normal-weight metadata text for action tooltips", () => {
    const source = readFileSync(join(repositoryRoot, "views.css"), "utf8");
    expect(source).toMatch(
      /\.ws-action-tooltip-content\s*\{[\s\S]*?font:\s*var\(--ws-text-metadata\);/,
    );
  });
});
