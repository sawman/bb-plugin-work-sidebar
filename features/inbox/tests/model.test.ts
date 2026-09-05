import { describe, expect, it } from "vitest";
import { splitInboxMarkdown } from "../model";

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
