import type { HumanMessage } from "./schemas";

/**
 * The host renders Mermaid even in an unclosed fence. Only hand it complete,
 * plain Mermaid fences. Leave the whole document intact so Markdown
 * (including enclosing code fences) keeps its original parsing/copy context.
 * Ambiguous container/escaped info strings use original message source.
 */
export function canRenderInboxMarkdown(content: string): boolean {
  let fence: { marker: string; length: number; mermaid: boolean } | null = null;
  for (const match of content.matchAll(/[^\r\n]*(?:\r\n|\r|\n|$)/g)) {
    const raw = match[0];
    if (!raw) continue;
    const line = raw.replace(/(?:\r\n|\r|\n)$/, "");
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (!boundary) {
      if (!fence) {
        const nestedInfo = getContainerFenceInfo(line);
        if (nestedInfo === null) continue;
        if (/^[ \t]*mermaid(?:\s|$)/i.test(nestedInfo) || /[&\\]/.test(nestedInfo)) return false;
      }
      continue;
    }
    const marker = boundary[1]!;
    const info = boundary[2]!;
    if (fence) {
      if (marker[0] !== fence.marker || marker.length < fence.length || !/^[ \t]*$/.test(info)) continue;
      fence = null;
      continue;
    }
    // Backtick fence info cannot itself contain backticks.
    if (marker[0] === "`" && info.includes("`")) continue;
    // Markdown decodes entities/escapes in info strings. Do not guess whether
    // one of these becomes a host Mermaid language label.
    if (/[&\\]/.test(info)) return false;
    const language = info.trim().split(/\s+/)[0]?.toLowerCase();
    if (language === "mermaid" && info.trim().toLowerCase() !== "mermaid") return false;
    fence = {
      marker: marker[0]!, length: marker.length, mermaid: language === "mermaid",
    };
  }
  return !fence?.mermaid;
}

function getContainerFenceInfo(line: string): string | null {
  let remaining = line.trimStart();
  while (remaining) {
    if (remaining.startsWith(">")) {
      remaining = remaining.slice(1).trimStart();
      continue;
    }
    const listPrefix = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(remaining);
    if (listPrefix) {
      remaining = remaining.slice(listPrefix[0].length).trimStart();
      continue;
    }
    return /^(?:`{3,}|~{3,})(.*)$/.exec(remaining)?.[1] ?? null;
  }
  return null;
}

type HumanMessageState = Pick<HumanMessage, "acknowledgedAt" | "bookmarkedAt">;

export function messageIsSaved(message: HumanMessageState) {
  return message.acknowledgedAt !== null && message.bookmarkedAt !== null;
}

export function messageIsInbox(message: HumanMessageState) {
  return message.acknowledgedAt === null;
}

export function messageIsHistory(message: HumanMessageState) {
  return message.acknowledgedAt !== null && message.bookmarkedAt === null;
}

export function messageLabel(message: HumanMessage) {
  return message.subject?.trim() || "Inbox message";
}
