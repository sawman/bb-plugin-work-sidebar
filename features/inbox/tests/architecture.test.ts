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
    expect(views).toContain("open={false}");
    expect(views).not.toContain("portal");
    expect(views).not.toContain("hideResults");
    expect(views).not.toMatch(/<input\b/);
    expect(views).toContain("WorkSection");
    expect(workflow).toContain("WorkSection");
    expect(workSection).toContain("CountedDisclosure");
    expect(styles).toContain(".ws-work-section-trigger");
    expect(styles).not.toContain(".ws-inbox-group h3");
    expect(views).not.toContain("ws-inbox-group");
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
