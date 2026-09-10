import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const views = readFileSync(new URL("../views.tsx", import.meta.url), "utf8");
const queries = readFileSync(new URL("../queries.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../../../views.css", import.meta.url), "utf8");
const workflow = readFileSync(new URL("../../tasks/workflow-card.tsx", import.meta.url), "utf8");
const workSection = readFileSync(new URL("../../../components/ui/work-section.tsx", import.meta.url), "utf8");

describe("Inbox architecture boundaries", () => {
  it("uses the shared search/disclosure primitives and host typography tokens", () => {
    expect(views).toContain("SearchCombobox");
    expect(views).toContain("hideResults");
    expect(views).not.toContain("portal");
    expect(views).toContain('aria-label="Search Inbox"');
    expect(views).not.toMatch(/<input\b/);
    expect(views).toContain("WorkSection");
    expect(workflow).toContain("WorkSection");
    expect(workSection).toContain("CountedDisclosure");
    expect(styles).toContain(".ws-work-section-trigger");
    expect(styles).toContain(".ws-inbox-search-trigger");
    expect(styles).toContain("--ws-inbox-heading-control-size: 1rem");
    expect(styles).toMatch(
      /\.ws-counted-disclosure\[data-meta-spacing="relaxed"\][\s\S]*?\.ws-counted-disclosure-meta\s*\{[\s\S]*?gap: 0\.32rem/,
    );
    expect(styles).toMatch(
      /\.ws-counted-disclosure-panel:empty\s*\{[\s\S]*?display: none/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-search-trigger\s*\{[\s\S]*?height: var\(--ws-inbox-heading-control-size\)/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-search-input\s*\{[\s\S]*?height: var\(--ws-inbox-heading-control-size\)/,
    );
    expect(styles).not.toContain(".ws-inbox-group h3");
    expect(views).not.toContain("ws-inbox-group");
    expect(views).toContain('icon={expanded ? "ChevronUp" : "ChevronDown"}');
    expect(views).not.toContain("ws-inbox-message-toggle");
    expect(views).not.toContain("ws-inbox-message-meta");
    expect(views).not.toContain("message.agentLabel");
    expect(views).not.toContain("<CopyBadge");
    expect(views).not.toContain('icon="Copy"');
    expect(views).toContain("ws-inbox-message-title-copy");
    expect(styles).toMatch(
      /\.ws-inbox-message\s*\{[\s\S]*?font: var\(--ws-text-metadata\)/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content\s*\{[\s\S]*?font: var\(--ws-text-metadata\)/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content > \*\s*\{[\s\S]*?font: inherit/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content :is\(code, pre\)\s*\{[\s\S]*?font: inherit;[\s\S]*?font-family: var\(--ws-text-font-family-code\)/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content :is\([\s\S]*?h1,[\s\S]*?p,[\s\S]*?blockquote,[\s\S]*?th,[\s\S]*?td[\s\S]*?\)\s*\{[\s\S]*?font: inherit;[\s\S]*?line-height: inherit/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content :is\(h1, h2, h3, h4, h5, h6, th\)\s*\{[\s\S]*?font: var\(--ws-text-metadata-emphasis\)/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content :is\(ul, ol\)\s*\{[\s\S]*?padding-inline-start:/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content blockquote\s*\{[\s\S]*?border-inline-start: 2px solid var\(--border\);[\s\S]*?padding-inline-start:/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content pre\s*\{[\s\S]*?max-width: 100%;[\s\S]*?overflow-x: auto/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content table\s*\{[\s\S]*?display: block;[\s\S]*?overflow-x: auto/,
    );
    expect(styles).toMatch(
      /\.ws-inbox-message-content :is\(img, video\)\s*\{[\s\S]*?height: auto;[\s\S]*?max-width: 100%/,
    );
    expect(styles).toContain(":first-child");
    expect(styles).toContain(":last-child");
    expect(styles).not.toContain("--bb-");
    expect(styles.slice(styles.lastIndexOf(".ws-inbox-card"))).not.toMatch(/font-size\s*:/);
  });

  it("keeps scope-safe debouncing, exact invalidation, optimistic count updates, and safe Mermaid policy explicit", () => {
    expect(views).toContain("setTimeout");
    expect(queries).toContain("useInfiniteQuery");
    expect(queries).toContain("queryKeys.inbox.scope(threadId, normalized)");
    expect(queries).toContain("getNextPageParam");
    expect(queries).toContain("queryKeys.inbox.thread(threadId)");
    expect(queries).toContain("activeCount");
    expect(queries).toContain("savedCount");
    expect(queries).toContain("historyCount");
    expect(views).not.toContain("mermaid-adapter");
    expect(views).toContain('aria-label="Mermaid diagram source"');
    expect(views).toContain("Mermaid rendering is disabled in this bundle");
  });

  it("places Inbox directly after Status and before Work items", () => {
    const composition = readFileSync(new URL("../../work-context/views.tsx", import.meta.url), "utf8");
    expect(composition.indexOf("<StatusCard")).toBeLessThan(composition.indexOf("<InboxCard"));
    expect(composition.indexOf("<InboxCard")).toBeLessThan(composition.indexOf("<WorkItemCard"));
  });
});
