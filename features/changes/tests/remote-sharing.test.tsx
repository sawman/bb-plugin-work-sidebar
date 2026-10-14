// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { changesKeys, remoteChangesIdentity } from "../model";
import { refreshChanges, useChanges } from "../queries";
import { currentPr } from "./latency-fixtures";
import { useAuthoredPullRequests, pullRequestKeys } from "../../pull-requests/queries";
import { factFromPullRequest, mergePullRequestFacts } from "../../pull-requests/facts";
const polling = { visiblePollMs: 60_000, backgroundPollMs: 300_000 };
const summary = (number = 1, repo = "acme/repo") => ({ currentPullRequest: { ...currentPr(number), url: `https://github.com/${repo}/pull/${number}` },
  stack: { number: 17, base: "main", currentPullRequest: number, pullRequests: [1, 2].map((entry) => ({
    ...currentPr(entry), url: `https://github.com/${repo}/pull/${entry}`, state: "open", draft: false, checks: "passing", review: "approved", reviewCommentCount: 0,
  })) }, stackUnavailableReason: null });
const repo = (branch: string) => ({ outcome: "available", branch, base: "main", message: null, ahead: 0, behind: 0, worktreeState: "clean", hasUncommittedChanges: false,
  changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] });
const diff = { additions: 3, deletions: 1, truncated: false, files: [{ path: "remote.ts", previousPath: null, status: "modified", additions: 3, deletions: 1 }] };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>((complete) => { resolve = complete; }); return { promise, resolve }; }
function wrapper(client: QueryClient) { return function QueryWrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={client}>{children}</QueryClientProvider>; }; }
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("R41 remote readiness and Query ownership", () => {
  it("two threads share remote files while local pending; warm switch paints promptly, settled local roster/diffs/flags win and canonical facts survive", async () => {
    const slow = deferred<any>();
    const client = new QueryClient();
    const rpc = { call: vi.fn(async (method: string, input: any) => {
      if (method === "getChangesRepository") return input.threadId === "thr_b" ? slow.promise : repo("local-A");
      if (method === "getChangesPullRequests") return summary(input.threadId === "thr_b" ? 2 : 1);
      if (method === "getChangesProjection") return slow.promise;
      if (method === "getChangesRemoteFiles") return { files: input.pullRequests.map((entry: any) => ({ ...entry, headSha: "head", baseSha: "base", diff })) };
      return { fingerprint: null };
    }) };
    const first = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(first.result.current.data?.githubStack?.stack?.branches[0].diff?.files[0].path).toBe("remote.ts"));
    expect(first.result.current.localReady).toBe(false);
    expect(first.result.current.data?.githubStack?.stack?.branches.every((branch) => !branch.isCurrent && !branch.hasStash && !branch.needsRebase && !branch.isQueued)).toBe(true);
    client.setQueryData(changesKeys.summary("thr_b"), summary(2));
    const second = renderHook(() => useChanges(rpc as never, "thr_b", polling), { wrapper: wrapper(client) });
    expect(second.result.current.data?.githubStack?.stack?.branches[0].diff?.files[0].path).toBe("remote.ts");
    expect(second.result.current.repository.isPending).toBe(true);
    expect(rpc.call.mock.calls.filter(([method]) => method === "getChangesRemoteFiles")).toHaveLength(1);
    const fact = factFromPullRequest({ ...currentPr(1), title: "canonical new title", state: "merged" });
    client.setQueryData(pullRequestKeys.factDirectory(), mergePullRequestFacts(undefined, [fact]));
    const localDiff = { ...diff, additions: 99 };
    await act(async () => { slow.resolve({ ...summary(1), githubStack: { pending: diff, error: null, stack: {
      trunk: "main", currentBranch: "local-A", trunkBehind: 5, prunableBranchCount: 1, branches: [
        { name: "feature/1", isCurrent: true, hasStash: true, stashCount: 2, needsRebase: true, isQueued: true, isMerged: false, aheadOfRemote: 4, behindRemote: 2,
          pr: { number: 1, url: currentPr(1).url, state: "open", title: "old", isDraft: false, metadataStale: false }, diff: localDiff },
        { name: "local-only", isCurrent: false, hasStash: false, stashCount: null, needsRebase: false, isQueued: false, isMerged: false, aheadOfRemote: null, behindRemote: null, pr: null, diff: null },
      ],
    } } }); });
    await waitFor(() => expect(first.result.current.localReady).toBe(true));
    expect(first.result.current.data?.githubStack?.stack?.branches).toHaveLength(2);
    expect(first.result.current.data?.githubStack?.stack?.branches[0]).toMatchObject({ isCurrent: true, hasStash: true, diff: { additions: 99 } });
    expect(first.result.current.data?.githubStack?.stack?.branches[1].name).toBe("local-only");
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts[fact.key].title).toBe("canonical new title");
    first.unmount(); second.unmount(); client.clear();
  });

  it("identity includes repo, stack, head/base roster; no-PR cannot inherit remote; force invalidates related remote/summary/patch keys but unrelated repositories and local working trees stay fresh", async () => {
    const client = new QueryClient();
    const a = summary(); const b = summary(2); const unrelated = summary(1, "other/repo");
    const identity = remoteChangesIdentity(a as never)!;
    expect(remoteChangesIdentity(b as never)?.content).toBe(identity.content);
    expect(remoteChangesIdentity(unrelated as never)?.repository).not.toBe(identity.repository);
    expect(remoteChangesIdentity({ ...a, stack: { ...a.stack, number: 18 } } as never)?.content).not.toBe(identity.content);
    expect(remoteChangesIdentity({ ...a, stack: { ...a.stack, pullRequests: [{ ...a.stack.pullRequests[0], head: "changed" }] } } as never)?.content).not.toBe(identity.content);
    expect(remoteChangesIdentity({ ...a, currentPullRequest: null } as never)).toBeNull();
    for (const [threadId, value] of [["thr_a", a], ["thr_b", b], ["thr_c", unrelated]] as const) {
      client.setQueryData(changesKeys.summary(threadId), value);
      client.setQueryData(changesKeys.repository(threadId), repo(threadId));
      client.setQueryData(changesKeys.projection(threadId), { ...value, githubStack: null });
      client.setQueryData(changesKeys.pullRequestFileDiff(threadId, 1, "a.ts", "sha"), { patch: "old" });
    }
    client.setQueryData(changesKeys.remoteFiles(identity.repository, identity.content), { files: [] });
    const calls: string[] = [];
    const rpc = { call: vi.fn(async (method: string) => { calls.push(method); return { ok: true }; }) };
    await refreshChanges(rpc as never, client, "thr_a");
    expect(calls).toEqual(["invalidateChangesRemote"]);
    expect(rpc.call).toHaveBeenCalledWith("invalidateChangesRemote", { repository: "acme/repo", threadIds: ["thr_a", "thr_b"] });
    for (const threadId of ["thr_a", "thr_b"]) {
      expect(client.getQueryState(changesKeys.summary(threadId))?.isInvalidated).toBe(true);
      expect(client.getQueryState(changesKeys.pullRequestFileDiff(threadId, 1, "a.ts", "sha"))?.isInvalidated).toBe(true);
    }
    expect(client.getQueryState(changesKeys.repository("thr_b"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(changesKeys.summary("thr_c"))?.isInvalidated).toBe(false);
    expect(client.getQueryState(changesKeys.remoteFiles(identity.repository, identity.content))?.isInvalidated).toBe(true);
    client.clear();
  });

  it("cancelled old remote response cannot resurrect warm content; observer unmount gets finite GC", async () => {
    const client = new QueryClient(); const old = deferred<any>(); let generation = 0;
    const rpc = { call: vi.fn(async (method: string, input: any) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesPullRequests") return summary();
      if (method === "getChangesProjection") return { ...summary(), githubStack: null };
      if (method === "getChangesRemoteFiles") return generation === 0 ? old.promise : { files: input.pullRequests.map((entry: any) => ({ ...entry, headSha: "new", baseSha: "base", diff: { ...diff, additions: 7 } })) };
      if (method === "invalidateChangesRemote") { generation++; return { ok: true }; }
      return { fingerprint: null };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    const second = renderHook(() => useChanges(rpc as never, "thr_b", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(second.result.current.data?.currentPullRequest).toBeTruthy());
    await waitFor(() => expect(rpc.call.mock.calls.filter(([method]) => method === "getChangesRemoteFiles")).toHaveLength(1));
    await act(async () => { await refreshChanges(rpc as never, client, "thr_a"); });
    await waitFor(() => expect(view.result.current.remoteFiles.data?.files[0].headSha).toBe("new"));
    await act(async () => { old.resolve({ files: [{ ...remoteChangesIdentity(summary() as never)!.input.pullRequests[0], headSha: "old", baseSha: "base", diff }] }); });
    expect(view.result.current.remoteFiles.data?.files[0].headSha).toBe("new");
    const identity = remoteChangesIdentity(summary() as never)!;
    expect(client.getQueryCache().find({ queryKey: changesKeys.remoteFiles(identity.repository, identity.content) })?.gcTime).toBe(600_000);
    view.unmount(); second.unmount(); client.clear();
  });
});

describe("R41 mounted remote expiry", () => {
  it("polls a stable semantic roster for sibling SHA changes while local enrichment is pending", async () => {
    vi.useFakeTimers(); const client = new QueryClient(); let additions = 1;
    const rpc = { call: vi.fn(async (method: string, input: any) => {
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesPullRequests") return summary();
      if (method === "getChangesProjection") return new Promise(() => {});
      if (method === "getChangesRemoteFiles") return { files: input.pullRequests.map((entry: any) => ({ ...entry, headSha: String(additions), baseSha: "base", diff: { ...diff, additions } })) };
      return { fingerprint: "unchanged" };
    }) };
    const view = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    expect(view.result.current.remoteFiles.data?.files[1].diff.additions).toBe(1);
    additions = 9;
    await act(async () => { await vi.advanceTimersByTimeAsync(180_001); });
    expect(view.result.current.remoteFiles.data?.files[1].diff.additions).toBe(9);
    expect(view.result.current.enrichment.isPending).toBe(true);
    view.unmount(); client.clear(); vi.useRealTimers();
  });
});

describe("R41 refresh coordination", () => {
  it("coalesces parallel manual/same-event refreshes and executes a distinct successor after failure", async () => {
    const client = new QueryClient(); client.setQueryData(changesKeys.summary("thr_a"), summary());
    const first = deferred<any>(); let calls = 0;
    const rpc = { call: vi.fn(async () => { calls++; return calls === 1 ? first.promise : { ok: true }; }) };
    const token = {};
    const a = refreshChanges(rpc as never, client, "thr_a", token);
    const b = refreshChanges(rpc as never, client, "thr_a", token);
    const manual = refreshChanges(rpc as never, client, "thr_a");
    await waitFor(() => expect(calls).toBe(1));
    const next = refreshChanges(rpc as never, client, "thr_a", {});
    first.resolve(Promise.reject(new Error("first failed")));
    await Promise.all([a, b, manual, next]);
    expect(calls).toBe(2);
    await refreshChanges(rpc as never, client, "thr_a"); expect(calls).toBe(3);
    client.clear();
  });
});

describe("R41 unknown refresh isolation", () => {
  it("parallel unknown threads refresh their own summary/projection and never globally clear GitHub", async () => {
    const client = new QueryClient(); const noPr = { currentPullRequest: null, stack: null, stackUnavailableReason: null };
    for (const threadId of ["thr_a", "thr_b"]) {
      client.setQueryData(changesKeys.summary(threadId), noPr);
      client.setQueryData(changesKeys.projection(threadId), { ...noPr, githubStack: null });
    }
    const calls: any[] = [];
    const rpc = { call: vi.fn(async (_method: string, input: any) => { calls.push(input); return { ok: true }; }) };
    await Promise.all([refreshChanges(rpc as never, client, "thr_a"), refreshChanges(rpc as never, client, "thr_b")]);
    expect(calls).toHaveLength(2);
    expect(calls).toContainEqual({ repository: null, threadIds: ["thr_a"] });
    expect(calls).toContainEqual({ repository: null, threadIds: ["thr_b"] });
    for (const threadId of ["thr_a", "thr_b"]) {
      expect(client.getQueryState(changesKeys.summary(threadId))?.isInvalidated).toBe(true);
      expect(client.getQueryState(changesKeys.projection(threadId))?.isInvalidated).toBe(true);
    }
    client.clear();
  });
});


describe("R41 cross-sidebar topology refresh", () => {
  it("right refresh and left force refresh update both mounted projections without loops", async () => {
    const client = new QueryClient(); let stackNumber = 17; let summaryReads = 0;
    const authored = { ...summary().stack.pullRequests[0], repository: "acme/repo", author: "me", stack: null };
    const rpc = { call: vi.fn(async (method: string, input: any) => {
      if (method === "sidebarAuthoredPullRequests") return { available: true, pullRequests: [authored], error: null };
      if (method === "sidebarAuthoredPullRequestStacks") return { available: true, pullRequests: [{ ...authored, stack: { number: stackNumber, base: "main", pullRequests: summary().stack.pullRequests } }], error: null };
      if (method === "getChangesPullRequests") { summaryReads++; return { ...summary(), stack: { ...summary().stack, number: stackNumber } }; }
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesProjection") return { ...summary(), stack: { ...summary().stack, number: stackNumber }, githubStack: null };
      if (method === "getChangesRemoteFiles") return { files: [] };
      if (method === "invalidateChangesRemote") return { ok: true };
      return { fingerprint: null };
    }) };
    const left = renderHook(() => useAuthoredPullRequests(rpc as never), { wrapper: wrapper(client) });
    const right = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(left.result.current.data?.[0].stack?.number).toBe(17));
    await waitFor(() => expect(right.result.current.data?.stack?.number).toBe(17));
    stackNumber = 18;
    await act(async () => { await right.result.current.refresh(); });
    await waitFor(() => expect(left.result.current.data?.[0].stack?.number).toBe(18));
    expect(right.result.current.data?.stack?.number).toBe(18);
    stackNumber = 19;
    await act(async () => { await left.result.current.refresh(); });
    await waitFor(() => expect(right.result.current.data?.stack?.number).toBe(19));
    expect(left.result.current.data?.[0].stack?.number).toBe(19);
    expect(summaryReads).toBe(3);
    left.unmount(); right.unmount(); client.clear();
  });
});


describe("R41 known and unknown independence", () => {
  it("keeps unrelated cold queries running while known and unknown refreshes each execute", async () => {
    const client = new QueryClient(); const cold = deferred<any>();
    client.setQueryData(changesKeys.summary("thr_known"), summary());
    const pending = client.fetchQuery({ queryKey: changesKeys.summary("thr_cold"), queryFn: () => cold.promise });
    const calls: any[] = [];
    const rpc = { call: vi.fn(async (_method: string, input: any) => { calls.push(input); return { ok: true }; }) };
    await Promise.all([refreshChanges(rpc as never, client, "thr_unknown"), refreshChanges(rpc as never, client, "thr_known")]);
    expect(calls).toContainEqual({ repository: null, threadIds: ["thr_unknown"] });
    expect(calls).toContainEqual({ repository: "acme/repo", threadIds: ["thr_known"] });
    expect(client.getQueryState(changesKeys.summary("thr_cold"))?.fetchStatus).toBe("fetching");
    cold.resolve(summary(2)); await pending;
    expect(client.getQueryData(changesKeys.summary("thr_cold"))).toEqual(summary(2));
    client.clear();
  });
});


describe("R41 initial authored projection retirement", () => {
  it("cancels a cold authored query before remote clear and never hydrates its late old facts", async () => {
    const client = new QueryClient(); const old = deferred<any>(); let generation = 0; let stackCalls = 0;
    const authored = { ...summary().stack.pullRequests[0], title: "new fact", repository: "acme/repo", author: "me", stack: null };
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "sidebarAuthoredPullRequests") return { available: true, pullRequests: [authored], error: null };
      if (method === "sidebarAuthoredPullRequestStacks") { stackCalls++; return generation === 0 ? old.promise : { available: true, pullRequests: [{ ...authored, stack: { number: 18, base: "main", pullRequests: [] } }], error: null }; }
      if (method === "invalidateChangesRemote") { generation++; return { ok: true }; }
      return { fingerprint: null };
    }) };
    client.setQueryData(changesKeys.summary("thr_a"), summary());
    const left = renderHook(() => useAuthoredPullRequests(rpc as never), { wrapper: wrapper(client) });
    await waitFor(() => expect(stackCalls).toBe(1));
    await act(async () => { await refreshChanges(rpc as never, client, "thr_a"); });
    await waitFor(() => expect(left.result.current.data?.[0].stack?.number).toBe(18));
    await act(async () => { old.resolve({ available: true, pullRequests: [{ ...authored, title: "stale fact", stack: { number: 17, base: "main", pullRequests: [] } }], error: null }); });
    expect(left.result.current.data?.[0].title).toBe("new fact");
    expect(left.result.current.data?.[0].stack?.number).toBe(18);
    expect(stackCalls).toBe(2);
    left.unmount(); client.clear();
  });
});


describe("R41 delayed authored hydration authority", () => {
  it("keeps fresh detailed metadata in both panes when the new topology carries cached lightweight metadata", async () => {
    const client = new QueryClient(); const delayed = deferred<any>(); let fresh = false;
    const authored = { number: 1, title: "cached old title", url: currentPr(1).url, repository: "acme/repo", state: "open", draft: false,
      head: "cached-head", base: "cached-base", checks: "passing", review: "approved", reviewCommentCount: 0, stack: null };
    const rpc = { call: vi.fn(async (method: string) => {
      if (method === "sidebarAuthoredPullRequests") return { available: true, pullRequests: [authored], error: null };
      if (method === "sidebarAuthoredPullRequestStacks") return fresh ? delayed.promise : { available: true, pullRequests: [{ ...authored, stack: { number: 17, base: "main", pullRequests: [] } }], error: null };
      if (method === "getChangesPullRequests" || method === "getChangesProjection") {
        const data = summary(); const title = fresh ? "fresh canonical title" : "cached old title";
        return { ...data, currentPullRequest: { ...data.currentPullRequest, title }, stack: { ...data.stack, number: fresh ? 18 : 17,
          pullRequests: data.stack.pullRequests.map((entry) => ({ ...entry, title: entry.number === 1 ? title : entry.title })) }, githubStack: null };
      }
      if (method === "getChangesRepository") return repo("A");
      if (method === "getChangesRemoteFiles") return { files: [] };
      if (method === "invalidateChangesRemote") return { ok: true };
      return { fingerprint: null };
    }) };
    const left = renderHook(() => useAuthoredPullRequests(rpc as never), { wrapper: wrapper(client) });
    const right = renderHook(() => useChanges(rpc as never, "thr_a", polling), { wrapper: wrapper(client) });
    await waitFor(() => expect(left.result.current.data?.[0].stack?.number).toBe(17));
    await waitFor(() => expect(right.result.current.data?.currentPullRequest?.title).toBe("cached old title"));
    fresh = true;
    let refreshed!: Promise<void>;
    act(() => { refreshed = right.result.current.refresh(); });
    await waitFor(() => expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts["acme/repo#1"].title).toBe("fresh canonical title"));
    await act(async () => { delayed.resolve({ available: true, pullRequests: [{ ...authored, stack: { number: 18, base: "main", pullRequests: [] } }], error: null }); await refreshed; });
    await waitFor(() => expect(left.result.current.data?.[0].stack?.number).toBe(18));
    expect(client.getQueryData<any>(pullRequestKeys.factDirectory()).facts["acme/repo#1"].title).toBe("fresh canonical title");
    expect(left.result.current.data?.[0].title).toBe("fresh canonical title");
    expect(right.result.current.data?.currentPullRequest?.title).toBe("fresh canonical title");
    expect(rpc.call.mock.calls.filter(([method]) => method === "sidebarAuthoredPullRequests")).toHaveLength(1);
    left.unmount(); right.unmount(); client.clear();
  });
});
