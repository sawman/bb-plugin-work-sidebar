import type { HumanMessage } from "./schemas";

export type InboxMarkdownSegment =
  | { kind: "markdown"; content: string }
  | { kind: "mermaid"; content: string };

/** Split exact Mermaid fences only outside enclosing Markdown code fences. */
export function splitInboxMarkdown(content: string): InboxMarkdownSegment[] {
  const segments: InboxMarkdownSegment[] = [];
  let cursor = 0;
  let fence: { marker: string; length: number; start: number; bodyStart: number; mermaid: boolean } | null = null;
  for (const match of content.matchAll(/[^\n]*(?:\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const line = raw.replace(/\r?\n$/, "");
    const start = match.index;
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!boundary) continue;
    const marker = boundary[1]!;
    const info = boundary[2]!;
    if (fence) {
      if (marker[0] !== fence.marker || marker.length < fence.length || !/^[ \t]*$/.test(info)) continue;
      if (fence.mermaid && line === "```" && start > fence.bodyStart) {
        if (fence.start > cursor)
          segments.push({ kind: "markdown", content: content.slice(cursor, fence.start) });
        segments.push({ kind: "mermaid", content: content.slice(fence.bodyStart, start).replace(/\r?\n$/, "") });
        cursor = start + line.length;
      }
      fence = null;
      continue;
    }
    // Backtick fence info cannot itself contain backticks.
    if (marker[0] === "`" && info.includes("`")) continue;
    fence = {
      marker: marker[0]!, length: marker.length, start, bodyStart: start + raw.length,
      mermaid: line === "```mermaid" && raw.endsWith("\n"),
    };
  }
  if (cursor < content.length || segments.length === 0)
    segments.push({ kind: "markdown", content: content.slice(cursor) });
  return segments.filter((segment) => segment.content.length > 0);
}

export function messageIsSaved(message: HumanMessage) {
  return message.acknowledgedAt !== null && message.bookmarkedAt !== null;
}

export function messageIsInbox(message: HumanMessage) {
  return message.acknowledgedAt === null;
}

export function messageLabel(message: HumanMessage) {
  return message.subject?.trim() || "Inbox message";
}
