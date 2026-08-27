import { describe, expect, it, vi } from "vitest";
import { readGitHub } from "../../shared/github/read-cache.js";
import { createServerLifecycle } from "../../server-lifecycle.js";

describe("shared GitHub read-cache lifecycle", () => {
  it("refuses reads started after disposal without invoking external work", async () => {
    const lifecycle = createServerLifecycle();
    lifecycle.dispose();
    const command = vi.fn(async () => "unexpected command");
    const classifier = vi.fn(() => ({
      state: "unavailable" as const,
      scope: "rest" as const,
      message: "unexpected classifier",
      retryAt: null,
    }));

    await expect(readGitHub(lifecycle, command, classifier, ["api", "repos/acme/work"], 1_000_000, 60_000))
      .rejects.toThrow("GitHub read lifecycle is disposed.");

    expect(command).not.toHaveBeenCalled();
    expect(classifier).not.toHaveBeenCalled();
    expect(lifecycle.inspect()).toEqual({ disposed: true, caches: 0, archived: false, backoffUntil: 0 });
    expect(lifecycle.githubReadCache.size).toBe(0);
    expect(lifecycle.githubReadPending.size).toBe(0);
    expect(lifecycle.githubRestHealth).toEqual({ state: "available", scope: "rest", message: null, retryAt: null });
  });

  it("serves a fresh GraphQL cache hit during an unrelated active rate-limit backoff", async () => {
    const lifecycle = createServerLifecycle();
    const args = ["api", "graphql", "-f", "query=stack"];
    const command = vi.fn(async () => "unexpected command");
    const classifier = vi.fn(() => ({
      state: "rate_limited" as const,
      scope: "graphql" as const,
      message: "unexpected classifier",
      retryAt: Date.now() + 60_000,
    }));

    lifecycle.cacheGitHubRead(args.join("\u0000"), "fresh cached GraphQL value", Date.now() + 60_000);
    lifecycle.githubGraphqlHealth = {
      state: "rate_limited",
      scope: "graphql",
      message: "GraphQL is rate limited by an unrelated read",
      retryAt: Date.now() + 60_000,
    };

    await expect(readGitHub(lifecycle, command, classifier, args, 1_000_000, 60_000))
      .resolves.toBe("fresh cached GraphQL value");
    expect(command).not.toHaveBeenCalled();
    expect(classifier).not.toHaveBeenCalled();
  });

  it("still gates cache misses and expired entries during active rate-limit backoff", async () => {
    const lifecycle = createServerLifecycle();
    const command = vi.fn(async () => "unexpected command");
    const classifier = vi.fn(() => ({
      state: "unavailable" as const,
      scope: "graphql" as const,
      message: "unexpected classifier",
      retryAt: null,
    }));
    const retryAt = Date.now() + 60_000;
    lifecycle.githubGraphqlHealth = {
      state: "rate_limited",
      scope: "graphql",
      message: "GraphQL is rate limited",
      retryAt,
    };

    await expect(readGitHub(lifecycle, command, classifier, ["api", "graphql", "-f", "query=miss"], 1_000_000, 60_000))
      .rejects.toThrow("GraphQL is rate limited");

    const expiredArgs = ["api", "graphql", "-f", "query=expired"];
    lifecycle.cacheGitHubRead(expiredArgs.join("\u0000"), "expired value", retryAt - 60_001);
    await expect(readGitHub(lifecycle, command, classifier, expiredArgs, 1_000_000, 60_000))
      .rejects.toThrow("GraphQL is rate limited");

    expect(command).not.toHaveBeenCalled();
    expect(classifier).not.toHaveBeenCalled();
  });

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
