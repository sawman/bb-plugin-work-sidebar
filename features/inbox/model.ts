import type { HumanMessage } from "./schemas";

export type InboxMarkdownSegment =
  | { kind: "markdown"; content: string }
  | { kind: "mermaid"; content: string };

const MERMAID_FENCE = /(^|\n)```mermaid\r?\n([\s\S]*?)\r?\n```(?=\n|$)/g;

/** Split only complete, exact-info Mermaid fences; all other Markdown is kept byte-for-byte. */
export function splitInboxMarkdown(content: string): InboxMarkdownSegment[] {
  const segments: InboxMarkdownSegment[] = [];
  let cursor = 0;
  for (const match of content.matchAll(MERMAID_FENCE)) {
    const start = match.index ?? 0;
    const prefix = match[1] ?? "";
    const fenceStart = start + prefix.length;
    if (fenceStart > cursor)
      segments.push({ kind: "markdown", content: content.slice(cursor, fenceStart) });
    segments.push({ kind: "mermaid", content: match[2] ?? "" });
    cursor = fenceStart + match[0].length - prefix.length;
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
