import { describe, expect, it, vi } from "vitest";
import { createRemoteCache } from "../remote-cache";
import { createRemoteFilesService } from "../remote-files-server";
import { createThreadStackService } from "../server-thread-stack";
import { readGitHubSignals } from "../server-stack";
import { currentPr } from "../../changes/tests/latency-fixtures";
import { createServerLifecycle } from "../../../server-lifecycle";
import { clearGitHubReadCache, readGitHub } from "../../../shared/github/read-cache";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => { resolve = complete; });
  return { promise, resolve };
}
describe("R41 raw remote generation", () => {
  it("force refresh retires pending raw reads and old responses cannot refill cache or remove replacement", async () => {
    const old = deferred<string>();
    const fresh = deferred<string>();
    const command = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const lifecycle = createServerLifecycle();
    const classify = () => ({ state: "unavailable" as const, scope: "rest" as const, message: "offline", retryAt: null });
    const first = readGitHub(lifecycle, command, classify, ["api", "repo"], 100, 30_000);
    const rejected = expect(first).rejects.toThrow(/changed/);
    clearGitHubReadCache(lifecycle);
    const second = readGitHub(lifecycle, command, classify, ["api", "repo"], 100, 30_000);
    expect(command).toHaveBeenCalledTimes(2);
    old.resolve("old");
    await rejected;
    expect(lifecycle.githubReadCache.size).toBe(0);
    expect(lifecycle.githubReadPending.size).toBe(1);
    fresh.resolve("fresh");
    await expect(second).resolves.toBe("fresh");
    expect([...lifecycle.githubReadCache.values()][0].value).toBe("fresh");
    lifecycle.dispose();
  });
});

describe("R41 bounded remote snapshots", () => {
  it("dedupes, expires, caps bytes/entries/pending, never stores failures or retired work", async () => {
    let now = 0;
    const cache = createRemoteCache<string>({ now: () => now, maxEntries: 2, maxBytes: 10, ttlMs: 30 });
    const slow = deferred<string>();
    const load = vi.fn(() => slow.promise);
    const a = cache.read("a", load);
    expect(cache.read("a", load)).toBe(a);
    await Promise.resolve();
    slow.resolve("one"); await a;
    expect(load).toHaveBeenCalledOnce();
    cache.put("b", "two"); cache.put("c", "tri");
    expect(cache.inspect()).toMatchObject({ entries: 2, bytes: 10 });
    now = 31; expect(cache.inspect().entries).toBe(0);
    cache.put("large", "this exceeds byte cap"); expect(cache.inspect().entries).toBe(0);
    await expect(cache.read("error", async () => { throw new Error("offline"); })).rejects.toThrow("offline");
    await expect(cache.read("error", async () => "ok")).resolves.toBe("ok");
    const old = deferred<string>();
    const oldRead = cache.read("a", () => old.promise);
    const rejected = expect(oldRead).rejects.toThrow("changed");
    await Promise.resolve(); cache.invalidate("a");
    const replacement = cache.read("a", async () => "new");
    old.resolve("old"); await rejected; await replacement;
    expect(await cache.read("a", async () => "bad")).toBe("new");
    const hanging = cache.read("b", () => new Promise<string>(() => {}));
    void hanging.catch(() => {});
    const hanging2 = cache.read("c", () => new Promise<string>(() => {}));
    void hanging2.catch(() => {});
    await expect(cache.read("d", async () => "excess")).rejects.toThrow("capacity");
    cache.dispose(); expect(cache.inspect()).toEqual({ entries: 0, pending: 0, bytes: 0, disposed: true });
    await expect(cache.read("new", async () => "old handle")).rejects.toThrow("disposed");
  });

  it("file collections coalesce across callers; repos and head/base identities differ; same-name force push during read rejects and retry works", async () => {
    const lifecycle = createServerLifecycle();
    let headSha = "sha1";
    let changeDuringFiles = false;
    const read = vi.fn(async (args: readonly string[]) => {
      if (args[3].endsWith("files?per_page=100")) {
        if (changeDuringFiles) headSha = "sha2";
        return JSON.stringify([{ filename: "a.ts", status: "modified", additions: 4, deletions: 2 }]);
      }
      return JSON.stringify({ head: { ref: "one", sha: headSha }, base: { ref: "main", sha: "base1" } });
    });
    const service = createRemoteFilesService(lifecycle, read);
    const input = { pullRequests: [{ url: "https://github.com/ACME/Repo/pull/1", head: "one", base: "main" }] };
    const [a, b] = await Promise.all([service.files(input), service.files(input)]);
    expect(a).toEqual(b); expect(read).toHaveBeenCalledTimes(3);
    expect(a.files[0]).toMatchObject({ headSha: "sha1", baseSha: "base1", diff: { additions: 4, deletions: 2 } });
    await service.files({ pullRequests: [{ ...input.pullRequests[0], url: "https://github.com/other/repo/pull/1" }] });
    expect(read).toHaveBeenCalledTimes(6);
    service.invalidate("acme/repo"); changeDuringFiles = true;
    await expect(service.files(input)).rejects.toThrow("identity changed during");
    changeDuringFiles = false;
    expect((await service.files(input)).files[0].headSha).toBe("sha2");
    await expect(service.files({ pullRequests: [{ ...input.pullRequests[0], head: "renamed" }] })).rejects.toThrow("identity changed");
    lifecycle.dispose(); await expect(service.files(input)).rejects.toThrow("disposed");
  });

  it("two thread environments on different PRs reuse one discovered remote roster but retain independent local payloads and extra branches", async () => {
    const lifecycle = createServerLifecycle();
    const members = [1, 2].map((number) => ({ number, state: "open", draft: false, title: `PR ${number}`,
      html_url: `https://github.com/acme/repo/pull/${number}`, head: { ref: `feature/${number}` }, base: { ref: "main" } }));
    const read = vi.fn(async (args: readonly string[]) => args[1] === "graphql"
      ? JSON.stringify({ data: { repository: { p0: { reviewDecision: "APPROVED", reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } }, p1: { reviewDecision: "APPROVED", reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } } } } })
      : args[3].includes("stacks") ? JSON.stringify([{ number: 17, base: { ref: "main" }, pull_requests: members }]) : "[]");
    const branch = (name: string, current: boolean) => ({ name, isCurrent: current, isMerged: false, isQueued: current, needsRebase: current,
      hasStash: current, stashCount: current ? 2 : 0, pr: null, diff: null, aheadOfRemote: 3, behindRemote: 1 });
    const bb = { sdk: { threads: { get: vi.fn(async ({ threadId }: { threadId: string }) => ({ environmentId: threadId })) },
      environments: { pullRequest: vi.fn(async ({ environmentId }: { environmentId: string }) => ({ outcome: "available", pullRequest: {
        ...currentPr(environmentId === "thr_a" ? 1 : 2), headRefName: `feature/${environmentId === "thr_a" ? 1 : 2}`, baseRefName: "main",
      } })) }, plugins: { callRpc: vi.fn(async ({ input }: { input: { threadId: string } }) => ({
        stack: { trunk: "main", currentBranch: input.threadId, branches: [branch(input.threadId, true), branch(`local-only-${input.threadId}`, false)], trunkBehind: 4, prunableBranchCount: 2 },
        pending: null, error: null, fetchedAt: 1,
      })) } } };
    const service = createThreadStackService(bb as never, lifecycle, read);
    const first = await service.summary("thr_a");
    const second = await service.summary("thr_b");
    expect(first.stack?.number).toBe(17); expect(second.stack?.number).toBe(17);
    expect(first.stack?.currentPullRequest).toBe(1); expect(second.stack?.currentPullRequest).toBe(2);
    expect(read.mock.calls.filter(([args]) => args[3]?.includes("stacks"))).toHaveLength(1);
    expect(bb.sdk.environments.pullRequest).toHaveBeenCalledTimes(2);
    const [localA, localB] = await Promise.all([service.projection("thr_a"), service.projection("thr_b")]);
    expect(localA.githubStack?.stack?.currentBranch).toBe("thr_a");
    expect(localB.githubStack?.stack?.currentBranch).toBe("thr_b");
    expect(localA.githubStack?.stack?.branches.map((entry) => entry.name)).toEqual(["thr_a", "local-only-thr_a"]);
    expect(localB.githubStack?.stack?.branches[0]).toMatchObject({ isCurrent: true, hasStash: true, stashCount: 2, needsRebase: true, isQueued: true, aheadOfRemote: 3 });
    lifecycle.dispose();
  });
});

describe("R41 related invalidation", () => {
  it("repo-scoped clear preserves unrelated pending/cache while retiring late signal aggregation", async () => {
    const lifecycle = createServerLifecycle();
    const signalResponse = deferred<string>();
    const readSignal = readGitHubSignals("acme", "repo", [1], lifecycle, () => signalResponse.promise);
    const signalRejected = expect(readSignal).rejects.toThrow("changed");
    const unrelated = deferred<string>();
    const command = vi.fn(() => unrelated.promise);
    const read = readGitHub(lifecycle, command, () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }),
      ["api", "--method", "GET", "repos/other/repo/pulls/1"], 100, 30_000);
    clearGitHubReadCache(lifecycle, "acme/repo");
    signalResponse.resolve(JSON.stringify({ data: { repository: { p0: { reviewDecision: "APPROVED" } } } }));
    await signalRejected;
    expect(lifecycle.githubPullRequestSignalCache.size).toBe(0);
    unrelated.resolve("unrelated");
    await expect(read).resolves.toBe("unrelated");
    expect(lifecycle.githubReadCache.size).toBe(1);
    lifecycle.dispose();
  });
});
