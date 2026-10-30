import { describe, expect, it } from "vitest";
import { canRenderInboxMarkdown, messageIsHistory, messageIsInbox, messageIsSaved } from "../model";

describe("Inbox Markdown host eligibility", () => {
  it("allows complete Mermaid and ordinary code but guards unsupported or incomplete Mermaid", () => {
    expect(canRenderInboxMarkdown("before\n```mermaid\ngraph TD\nA-->B\n```\nafter")).toBe(true);
    expect(canRenderInboxMarkdown("```mermaid dark\nA-->B\n```\n```js\nalert(1)\n```")).toBe(false);
    expect(canRenderInboxMarkdown("```mermaid\ngraph TD\nA-->B")).toBe(false);
    expect(canRenderInboxMarkdown("```js\nconst incomplete = 1")).toBe(true);
  });

  it("handles long container-like prose without a backtracking fence expression", () => {
    expect(canRenderInboxMarkdown(`${"- > ".repeat(7000)}plain text`)).toBe(true);
    expect(canRenderInboxMarkdown(`${"> ".repeat(7000)}\`\`\`mermaid\nA-->B`)).toBe(false);
  });
});

it("partitions Inbox, Saved, and History without duplicate rows", () => {
  const state = (acknowledgedAt: string | null, bookmarkedAt: string | null) => ({ acknowledgedAt, bookmarkedAt });
  const classification = (message: ReturnType<typeof state>) => [
    messageIsInbox(message), messageIsSaved(message), messageIsHistory(message),
  ];
  expect(classification(state(null, null))).toEqual([true, false, false]);
  expect(classification(state("2026-09-10T00:00:00.000Z", "2026-09-10T00:00:01.000Z")))
    .toEqual([false, true, false]);
  expect(classification(state("2026-09-10T00:00:00.000Z", null))).toEqual([false, false, true]);
});

it.each(["````markdown", "~~~~markdown", "   `````text"])("keeps literal Mermaid inside %s untouched", (opener) => {
  const closer = opener.trim().match(/^[`~]+/)![0];
  const literal = `${opener}\nexample\n\`\`\`mermaid\ngraph TD\nA-->B\n\`\`\`\n${closer}`;
  expect(canRenderInboxMarkdown(literal)).toBe(true);
  expect(canRenderInboxMarkdown(`${literal}\n\`\`\`mermaid\nC-->D\n\`\`\``)).toBe(true);
});
