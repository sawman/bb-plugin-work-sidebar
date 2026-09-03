import { describe, expect, it, vi } from "vitest";
import { createPullRequestService } from "../server";
import { resolveReviewState } from "../server-stack";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, resolve, reject };
}

describe("R5 pull-request server ownership", () => {
  it("only treats changes as re-requested for the same reviewer", () => {
    expect(
      resolveReviewState({
        reviewDecision: "CHANGES_REQUESTED",
        requestedReviewers: ["octocat"],
        reviewerStates: new Map([["octocat", "CHANGES_REQUESTED"]]),
      }),
    ).toBe("review_required");
    expect(
      resolveReviewState({
        reviewDecision: "CHANGES_REQUESTED",
        requestedReviewers: ["hubot"],
        reviewerStates: new Map([["octocat", "CHANGES_REQUESTED"]]),
      }),
    ).toBe("changes_requested");
    expect(
      resolveReviewState({
        reviewDecision: "CHANGES_REQUESTED",
        requestedReviewers: ["octocat"],
        reviewerStates: new Map([
          ["octocat", "CHANGES_REQUESTED"],
          ["hubot", "CHANGES_REQUESTED"],
        ]),
      }),
    ).toBe("changes_requested");
  });

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
    await expect(service.setDraft("https://github.com/acme/sidebar/pull/12", false)).rejects.toThrow("disposed");
  });

  it("does not let an older in-flight result overwrite a forced replacement generation", async () => {
    const first = deferred<Array<{ repository: string; title: string }>>();
    const second = deferred<Array<{ repository: string; title: string }>>();
    const readAuthored = vi.fn()
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);
    const service = createPullRequestService({
      now: () => 0, readAuthored, readStacks: async (items) => items,
      archivedRepositories: async () => new Set(), setDraft: async () => ({ draft: true }),
    });
    const oldRead = service.authored();
    const replacement = service.authored(true);
    second.resolve([{ repository: "acme/sidebar", title: "new" }]);
    await expect(replacement).resolves.toEqual([{ repository: "acme/sidebar", title: "new" }]);
    first.resolve([{ repository: "acme/sidebar", title: "old" }]);
    await expect(oldRead).resolves.toEqual([{ repository: "acme/sidebar", title: "old" }]);
    expect(await service.authored()).toEqual([{ repository: "acme/sidebar", title: "new" }]);
  });

  it("does not let an older in-flight stack enrichment overwrite a forced replacement", async () => {
    const oldStacks = deferred<Array<{ repository: string; title: string }>>();
    const newStacks = deferred<Array<{ repository: string; title: string }>>();
    const readStacks = vi.fn()
      .mockImplementationOnce(() => oldStacks.promise)
      .mockImplementationOnce(() => newStacks.promise);
    const service = createPullRequestService({
      now: () => 0,
      readAuthored: async () => [{ repository: "acme/sidebar", title: "base" }],
      readStacks,
      archivedRepositories: async () => new Set(),
      setDraft: async () => ({ draft: true }),
    });
    const oldRead = service.stacks();
    await Promise.resolve();
    const replacement = service.stacks(true);
    await Promise.resolve();
    newStacks.resolve([{ repository: "acme/sidebar", title: "new stack" }]);
    await expect(replacement).resolves.toEqual([{ repository: "acme/sidebar", title: "new stack" }]);
    oldStacks.resolve([{ repository: "acme/sidebar", title: "old stack" }]);
    await expect(oldRead).resolves.toEqual([{ repository: "acme/sidebar", title: "old stack" }]);
    expect(await service.stacks()).toEqual([{ repository: "acme/sidebar", title: "new stack" }]);
  });

  it("detaches pre-mutation pending reads so ordinary refetches enter the new generation", async () => {
    const oldRead = deferred<Array<{ repository: string; title: string }>>();
    const newRead = deferred<Array<{ repository: string; title: string }>>();
    const readAuthored = vi.fn()
      .mockImplementationOnce(() => oldRead.promise)
      .mockImplementationOnce(() => newRead.promise);
    const service = createPullRequestService({
      now: () => 0,
      readAuthored,
      readStacks: async (items) => items,
      archivedRepositories: async () => new Set(),
      setDraft: async () => ({ draft: true }),
    });
    const staleCaller = service.authored();
    await service.setDraft("https://github.com/acme/sidebar/pull/12", true);
    const freshCaller = service.authored();
    expect(readAuthored).toHaveBeenCalledTimes(2);
    newRead.resolve([{ repository: "acme/sidebar", title: "new generation" }]);
    await expect(freshCaller).resolves.toEqual([{ repository: "acme/sidebar", title: "new generation" }]);
    oldRead.resolve([{ repository: "acme/sidebar", title: "old generation" }]);
    await expect(staleCaller).resolves.toEqual([{ repository: "acme/sidebar", title: "old generation" }]);
    expect(await service.authored()).toEqual([{ repository: "acme/sidebar", title: "new generation" }]);
  });
});
