import { describe, expect, it, vi } from "vitest";
import { createPullRequestService } from "../server";

describe("R5 pull-request server ownership", () => {
  it("deduplicates authored list and stack reads, filters archived repositories, and classifies rate limits without retrying", async () => {
    let now = 100;
    const readAuthored = vi.fn(async () => [
      { number: 1, title: "active", url: "https://github.com/acme/active/pull/1", repository: "acme/active", state: "open" as const, draft: false, head: "one", base: "main", checks: "passing" as const, review: "none" as const, reviewCommentCount: 0, stack: null },
      { number: 2, title: "archived", url: "https://github.com/acme/archived/pull/2", repository: "acme/archived", state: "open" as const, draft: false, head: "two", base: "main", checks: "none" as const, review: "none" as const, reviewCommentCount: 0, stack: null },
    ]);
    const service = createPullRequestService({
      now: () => now,
      readAuthored,
      readStacks: vi.fn(async (items) => items),
      archivedRepositories: vi.fn(async () => new Set(["acme/archived"])),
      setDraft: vi.fn(async () => ({ draft: true })),
    });
    const [left, right] = await Promise.all([service.authored(), service.authored()]);
    expect(left).toHaveLength(1);
    expect(right).toEqual(left);
    expect(readAuthored).toHaveBeenCalledTimes(1);
    await service.stacks();
    await service.stacks();
    expect(service.inspect()).toMatchObject({ authoredCached: true, stacksCached: true, pending: 0 });

    const rateLimit = new Error("API rate limit already exceeded");
    expect(service.classifyError(rateLimit, "rest")).toMatchObject({ state: "rate_limited", scope: "rest" });
    expect(service.clientRetryAllowed(rateLimit)).toBe(false);
    now += 301_000;
    await service.authored();
    expect(readAuthored).toHaveBeenCalledTimes(2);
  });

  it("clears caches after a draft update and disposal", async () => {
    const setDraft = vi.fn(async () => ({ draft: true }));
    const service = createPullRequestService({
      now: () => 0,
      readAuthored: async () => [], readStacks: async (items) => items,
      archivedRepositories: async () => new Set(), setDraft,
    });
    await service.authored();
    await service.setDraft("https://github.com/acme/sidebar/pull/12", true);
    expect(setDraft).toHaveBeenCalledOnce();
    expect(service.inspect()).toMatchObject({ authoredCached: false, stacksCached: false });
    service.dispose();
    expect(service.inspect()).toEqual({ disposed: true, authoredCached: false, stacksCached: false, pending: 0 });
  });
});
