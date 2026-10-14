import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import { createPullRequestRegistration } from "../server-registration";
import { createChangesRegistration } from "../../changes/server-registration";
import { createRepositoryTopologyReader } from "../remote-topology-server";
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

describe("R41 topology upstream deadline", () => {
  it("a119s refill and aliases cannot extend contributing raw120s expiry", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const lifecycle = createServerLifecycle(); let title = "old";
    const command = vi.fn(async (args: readonly string[]) => args[3]?.includes("stacks")
      ? JSON.stringify([{ number: 17, base: { ref: "main" }, pull_requests: [{ number: 1, state: "open", draft: false, title,
        html_url: currentPr(1).url, head: { ref: "feature/1" }, base: { ref: "main" } }] }])
      : JSON.stringify({ data: { repository: { p0: { reviewDecision: "APPROVED", reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } } } } }));
    const read = (args: readonly string[], buffer: number, ttlMs = 120_000) => readGitHub(lifecycle, command,
      () => ({ state: "unavailable", scope: "rest", message: null, retryAt: null }), args, buffer, ttlMs);
    const bb = { sdk: { threads: { get: async () => ({ environmentId: "env" }) }, environments: { pullRequest: async () => ({
      outcome: "available", pullRequest: { ...currentPr(1), headRefName: "feature/1", baseRefName: "main" },
    }) } } };
    const service = createThreadStackService(bb as never, lifecycle, read);
    expect((await service.summary("thr_a")).stack?.pullRequests[0].title).toBe("old");
    title = "new"; vi.setSystemTime(219_000);
    expect((await service.summary("thr_b")).stack?.pullRequests[0].title).toBe("old");
    vi.setSystemTime(220_001);
    expect((await service.summary("thr_c")).stack?.pullRequests[0].title).toBe("new");
    expect(command.mock.calls.filter(([args]) => args[3]?.includes("stacks"))).toHaveLength(2);
    lifecycle.dispose(); vi.useRealTimers();
  });
});

describe("R41 conditional file validation budget", () => {
  it("hits do not advance120s validation; stable SHA costs one lookup and changed SHA costs three", async () => {
    vi.useFakeTimers(); vi.setSystemTime(100_000);
    const lifecycle = createServerLifecycle(); let sha = "one";
    const read = vi.fn(async (args: readonly string[]) => args[3].endsWith("files?per_page=100")
      ? JSON.stringify([{ filename: "a.ts", status: "modified", additions: 1, deletions: 0 }])
      : JSON.stringify({ head: { ref: "one", sha }, base: { ref: "main", sha: "base" } }));
    const service = createRemoteFilesService(lifecycle, read);
    const input = { pullRequests: [{ url: "https://github.com/acme/repo/pull/1", head: "one", base: "main" }] };
    await service.files(input); expect(read).toHaveBeenCalledTimes(3);
    for (const elapsed of [30_000, 60_000, 90_000, 119_999]) { vi.setSystemTime(100_000 + elapsed); await service.files(input); }
    expect(read).toHaveBeenCalledTimes(3);
    vi.setSystemTime(220_000); await service.files(input); expect(read).toHaveBeenCalledTimes(4);
    sha = "two"; vi.setSystemTime(340_000);
    expect((await service.files(input)).files[0].headSha).toBe("two");
    expect(read).toHaveBeenCalledTimes(7);
    expect(read.mock.calls.filter(([args]) => args[3].endsWith("files?per_page=100"))).toHaveLength(2);
    service.invalidate("acme/repo"); await service.files(input); expect(read).toHaveBeenCalledTimes(10);
    lifecycle.dispose(); vi.useRealTimers();
  });
});

describe("R41 registered common topology", () => {
  it.each(["left-first", "right-first"])("%s uses one semantic repository batch; authored filtering does not prune full right topology", async (order) => {
    const host = createFakePluginHost(); const lifecycle = createServerLifecycle();
    const rawMembers = [1, 2].map((number) => ({ number, state: number === 2 ? "merged" : "open", draft: false,
      title: `Raw ${number}`, html_url: currentPr(number).url, head: { ref: `feature/${number}` }, base: { ref: "main" } }));
    let stackNumber = 17;
    const read = vi.fn(async (args: readonly string[]) => {
      if (args[0] === "search") return JSON.stringify([{ number: 1, title: "Authored title", url: currentPr(1).url, repository: { nameWithOwner: "acme/repo" }, state: "OPEN", isDraft: false }]);
      if (args[3]?.includes("stacks")) return JSON.stringify([[{ number: stackNumber, base: { ref: "main" }, pull_requests: rawMembers }]]);
      if (args.join(" ").includes("isArchived")) return JSON.stringify({ data: { r0: { isArchived: false } } });
      return JSON.stringify({ data: { repository: {
        p0: { headRefName: "feature/1", baseRefName: "main", reviewDecision: "APPROVED", reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } },
        p1: { headRefName: "feature/2", baseRefName: "main", reviewDecision: "APPROVED", reviewRequests: { nodes: [] }, reviews: { nodes: [] }, commits: { nodes: [] } },
      } } });
    });
    const bb = { ...host.bb, sdk: { ...host.bb.sdk,
      threads: { get: vi.fn(async () => ({ environmentId: "env" })) },
      environments: { pullRequest: vi.fn(async () => ({ outcome: "available", pullRequest: { ...currentPr(1), headRefName: "feature/1", baseRefName: "main" } })) },
    } };
    const pullRequests = createPullRequestRegistration(bb as never, lifecycle, { read, execute: vi.fn() });
    const changes = createChangesRegistration({ bb, pullRequests } as never);
    const loadLeft = () => pullRequests.sidebarAuthoredPullRequestStacks(null);
    const loadRight = () => changes.getChangesPullRequests({ threadId: "thr_a" });
    const left = order === "left-first" ? await loadLeft() : (await loadRight(), await loadLeft());
    const right = await loadRight();
    expect(left.available).toBe(true); expect(left.pullRequests).toHaveLength(1);
    expect(left.pullRequests[0].title).toBe("Authored title");
    expect(left.pullRequests[0].stack?.pullRequests.map((entry) => entry.number)).toEqual([1]);
    expect(right.stack?.pullRequests.map((entry) => entry.number)).toEqual([1, 2]);
    expect(read.mock.calls.filter(([args]) => args[3]?.includes("stacks"))).toHaveLength(1);
    expect(read.mock.calls.find(([args]) => args[3]?.includes("stacks"))![0]).toContain("--paginate");
    stackNumber = 18;
    changes.invalidateChangesRemote({ repository: "acme/repo" });
    expect((await loadRight()).stack?.number).toBe(18);
    expect((await loadLeft()).pullRequests[0].stack?.number).toBe(18);
    lifecycle.dispose();
  });

  it("isolates same stack/PR numbers by repo and retains full targeted fallback when listing omits a stack", async () => {
    const lifecycle = createServerLifecycle();
    const read = vi.fn(async (args: readonly string[]) => {
      const scope = args[3].includes("other/repo") ? "other/repo" : "acme/repo";
      if (args.includes("--paginate") && scope === "acme/repo") return "[]";
      return JSON.stringify([{ number: 17, base: { ref: "main" }, pull_requests: [1, 2].map((number) => ({
        number, state: number === 2 ? "merged" : "open", draft: false, title: `${scope} ${number}`,
        html_url: `https://github.com/${scope}/pull/${number}`, head: { ref: `feature/${number}` }, base: { ref: "main" },
      })) }]);
    });
    const topology = createRepositoryTopologyReader(lifecycle, read);
    expect((await topology.member("acme", "repo", 1, "feature/1", "main"))?.pullRequests).toHaveLength(2);
    expect((await topology.repository("acme", "repo"))[0].pullRequests[1].state).toBe("merged");
    expect((await topology.member("other", "repo", 1, "feature/1", "main"))?.pullRequests[0].title).toBe("other/repo 1");
    expect(read.mock.calls.filter(([args]) => args.includes("--paginate"))).toHaveLength(2);
    clearGitHubReadCache(lifecycle, "acme/repo");
    await topology.member("acme", "repo", 1, "feature/1", "main");
    expect(read.mock.calls.filter(([args]) => args[3].includes("acme/repo"))).toHaveLength(4);
    await topology.member("other", "repo", 1, "feature/1", "main");
    expect(read.mock.calls.filter(([args]) => args[3].includes("other/repo"))).toHaveLength(1);
    lifecycle.dispose(); await expect(topology.repository("acme", "repo")).rejects.toThrow("disposed");
  });
});

describe("R41 immutable pending identity", () => {
  it("a new SHA pair cannot join an old file command even with identical GitHub args", async () => {
    const lifecycle = createServerLifecycle(); const old = deferred<string>(); const fresh = deferred<string>();
    const command = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(fresh.promise);
    const classify = () => ({ state: "unavailable" as const, scope: "rest" as const, message: null, retryAt: null });
    const args = ["api", "--method", "GET", "repos/acme/repo/pulls/1/files?per_page=100"];
    const a = readGitHub(lifecycle, command, classify, args, 100, 0, "head1:base");
    const b = readGitHub(lifecycle, command, classify, args, 100, 0, "head2:base");
    expect(command).toHaveBeenCalledTimes(2);
    fresh.resolve("new head"); await expect(b).resolves.toBe("new head");
    old.resolve("old head"); await expect(a).resolves.toBe("old head");
    expect(lifecycle.githubReadCache.size).toBe(0); lifecycle.dispose();
  });
});

describe("R41 unknown thread read retirement", () => {
  it("repository invalidation leaves an unrelated not-yet-discovered host association alive", async () => {
    const pending = deferred<any>(); const lifecycle = createServerLifecycle();
    const bb = { sdk: { threads: { get: async () => ({ environmentId: "env_unknown" }) }, environments: { pullRequest: () => pending.promise } } };
    const service = createThreadStackService(bb as never, lifecycle, vi.fn(async () => "[]"));
    const unknown = service.summary("thr_unknown");
    await Promise.resolve(); await Promise.resolve();
    service.invalidateRemote("acme/repo");
    pending.resolve({ outcome: "not_applicable" });
    await expect(unknown).resolves.toMatchObject({ currentPullRequest: null, stack: null });
    lifecycle.dispose();
  });
});
