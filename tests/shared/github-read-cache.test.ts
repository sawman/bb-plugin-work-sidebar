import { describe, expect, it, vi } from "vitest";
import { readGitHub } from "../../shared/github/read-cache.js";
import { createServerLifecycle } from "../../server-lifecycle.js";

describe("shared GitHub read-cache lifecycle", () => {
  it("does not let a disposed generation write caches, health, or replacement pending work", async () => {
    let resolveFirst!: (value: string) => void;
    const firstCommand = new Promise<string>((resolve) => { resolveFirst = resolve; });
    const first = createServerLifecycle();
    const firstRead = readGitHub(first, async () => firstCommand, () => ({
      state: "rate_limited", scope: "rest", message: "limited", retryAt: 1,
    }), ["api", "repos/acme/work"], 1_000_000, 60_000);
    expect(first.githubReadPending.size).toBe(1);

    first.dispose();
    const replacement = createServerLifecycle();
    const replacementPending = Promise.resolve("replacement");
    replacement.githubReadPending.set("api\u0000repos/acme/work", replacementPending);
    resolveFirst("old generation");
    await expect(firstRead).resolves.toBe("old generation");

    expect(first.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
    expect(replacement.githubReadPending.get("api\u0000repos/acme/work")).toBe(replacementPending);
    expect(replacement.githubReadCache.size).toBe(0);
    expect(replacement.githubRestHealth).toEqual({ state: "available", scope: "rest", message: null, retryAt: null });
  });

  it("does not classify or back off a deferred failure after disposal", async () => {
    let rejectRead!: (error: Error) => void;
    const deferred = new Promise<string>((_resolve, reject) => { rejectRead = reject; });
    const lifecycle = createServerLifecycle();
    const classifier = vi.fn(() => ({
      state: "rate_limited" as const,
      scope: "graphql" as const,
      message: "limited",
      retryAt: 123,
    }));
    const read = readGitHub(lifecycle, async () => deferred, classifier, ["api", "graphql"], 1_000_000, 60_000);
    lifecycle.dispose();
    rejectRead(new Error("late failure"));

    await expect(read).rejects.toThrow("late failure");
    expect(classifier).not.toHaveBeenCalled();
    expect(lifecycle.githubGraphqlHealth).toEqual({ state: "available", scope: "graphql", message: null, retryAt: null });
    expect(lifecycle.githubGraphqlBackoffUntil).toBe(0);
    expect(lifecycle.githubReadPending.size).toBe(0);
  });
});
