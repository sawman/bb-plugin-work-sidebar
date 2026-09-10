import { describe, expect, it } from "vitest";
import { messageIsHistory, messageIsInbox, messageIsSaved, splitInboxMarkdown } from "../model";

describe("Inbox Markdown segmentation", () => {
  it("only extracts complete fenced mermaid blocks with the exact info string", () => {
    expect(splitInboxMarkdown("before\n```mermaid\ngraph TD\nA-->B\n```\nafter")).toEqual([
      { kind: "markdown", content: "before\n" },
      { kind: "mermaid", content: "graph TD\nA-->B" },
      { kind: "markdown", content: "\nafter" },
    ]);
    expect(splitInboxMarkdown("```mermaid dark\nA-->B\n```\n```js\nalert(1)\n```")).toEqual([
      { kind: "markdown", content: "```mermaid dark\nA-->B\n```\n```js\nalert(1)\n```" },
    ]);
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
  expect(splitInboxMarkdown(literal)).toEqual([{ kind: "markdown", content: literal }]);
  expect(splitInboxMarkdown(`${literal}\n\`\`\`mermaid\nC-->D\n\`\`\``)).toEqual([
    { kind: "markdown", content: `${literal}\n` },
    { kind: "mermaid", content: "C-->D" },
  ]);
});
