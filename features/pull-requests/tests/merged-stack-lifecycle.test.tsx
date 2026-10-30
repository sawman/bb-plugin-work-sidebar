import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, expect, it, vi } from "vitest";
import { ChangesPanel } from "../../changes/panel";
import { changesInteractionStore } from "../../changes/store";
import { ThreadMetadata } from "../../threads/thread-row-presentation";
import { AuthoredPullRequestStack } from "../authored-pull-requests";
import { factFromPullRequest, resolvePullRequestFact, type PullRequestFactDirectory } from "../facts";
import { hydratePullRequestFacts, pullRequestKeys, useAuthoredPullRequests, useSharedThreadPullRequestDirectory, type PullRequestRpc } from "../queries";
import { useRpc } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../../contracts";
import { currentPr } from "../../changes/tests/latency-fixtures";

afterEach(() => { cleanup(); changesInteractionStore.setState({ byThread: new Map() }); });

it("publishes a merged sibling through stale detailed OPEN facts into both bars without changing the current PR or local flags", async () => {
  const client = new QueryClient();
  const sibling = currentPr(2518, "Detailed sibling title");
  const current = currentPr(2531, "Current PR");
  const previousFact = factFromPullRequest(sibling);
  hydratePullRequestFacts(client, [previousFact], { thr_sibling: previousFact.key });
  const light = (pr: ReturnType<typeof currentPr>) => ({ ...pr, repository: "acme/repo", draft: false,
    checks: "passing" as const, review: "approved" as const, reviewCommentCount: 0 });
  const cachedStack = { id: "stack", number: 7, base: "main", currentPullRequest: 2531,
    pullRequests: [light(sibling), light(current)] };
  const mergedLayer = { ...light(sibling), title: "Older topology title", state: "merged" as const };
  const summary = { currentPullRequest: current, stack: { ...cachedStack, pullRequests: [mergedLayer, light(current)] }, stackUnavailableReason: null };
  let completeSummary!: (value: typeof summary) => void;
  const pendingSummary = new Promise<typeof summary>((resolve) => { completeSummary = resolve; });
  const projection = { ...summary, githubStack: { pending: null, error: null, stack: {
    trunk: "main", currentBranch: current.head, trunkBehind: 0, prunableBranchCount: 0,
    branches: [sibling, current].map((pr) => ({
      name: pr.head, isCurrent: pr.number === current.number, isMerged: false, isQueued: false,
      needsRebase: false, hasStash: pr.number === sibling.number, stashCount: pr.number === sibling.number ? 2 : null,
      aheadOfRemote: 3, behindRemote: 0,
      pr: { number: pr.number, url: pr.url, title: pr.title, state: "open", isDraft: false, metadataStale: false },
      diff: { additions: 1, deletions: 0, truncated: false, files: [{ path: `${pr.number}.ts`, previousPath: null, status: "modified", additions: 1, deletions: 0 }] },
    })),
  } } };
  const read = vi.fn(async (method: string, input: any) => {
    switch (method) {
      case "pullRequests": return { env_current: { outcome: "available", pullRequest: {
        number: current.number, title: current.title, url: current.url, state: current.state,
        checks: current.checks, review: current.review, mergeability: current.mergeability,
        headRefName: current.head, baseRefName: current.base, updatedAt: "2026-10-30T00:00:00Z",
        autoMerge: false, inMergeQueue: null, attention: "ready_to_merge",
      } } };
      case "sidebarAuthoredPullRequests":
      case "sidebarAuthoredPullRequestStacks": return { available: true, pullRequests: [{ ...light(current), stack: cachedStack }], error: null };
      case "getChangesRepository": return { outcome: "available", message: null, branch: current.head, base: "main", ahead: 0, behind: 0,
        worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] };
      case "getChangesPullRequests": return pendingSummary;
      case "getChangesProjection": return projection;
      case "getChangesRemoteFiles": return { files: [] };
      case "getChangesFingerprint": return { fingerprint: "stable" };
      case "getPullRequestFileDiff": return { kind: "absent", path: input.path, patch: null, message: "No diff" };
      case "getSidebarAppearance": return {};
      case "getGitHubApiHealth": return { state: "available", scope: "unknown", message: null, retryAt: null };
      default: throw new Error(`Unexpected ${method}`);
    }
  });
  const rpc = Object.fromEntries(["pullRequests", "sidebarAuthoredPullRequests", "sidebarAuthoredPullRequestStacks",
    "getChangesRepository", "getChangesPullRequests", "getChangesProjection", "getChangesRemoteFiles", "getChangesFingerprint",
    "getPullRequestFileDiff", "getSidebarAppearance", "getGitHubApiHealth"].map((method) => [method, (input: unknown) => read(method, input)]));
  function Left() {
    const transport = useRpc<typeof rpcContract>() as PullRequestRpc;
    const authored = useAuthoredPullRequests(transport);
    const directory = useSharedThreadPullRequestDirectory();
    const stack = authored.data?.[0]?.stack;
    return <>
      <section aria-label="left thread"><ThreadMetadata thread={{ environment: { branchName: sibling.head } } as PluginSidebarThread}
        projectLabel="Repository" pullRequest={directory.data.thr_sibling ?? null} pullRequestLoading={false} /></section>
      <section aria-label="left authored">{stack && <AuthoredPullRequestStack stack={stack} changingDraftUrl={null} onToggleDraft={vi.fn()} />}</section>
    </>;
  }
  const Content = () => <QueryClientProvider client={client}><Left /><section aria-label="right Changes"><ChangesPanel threadId="thr_current" environmentId="env_current" /></section></QueryClientProvider>;
  const slot = renderSlot({ component: Content }, {}, { rpc: rpc as never });
  const badge = (surface: string) => within(slot.getByRole("region", { name: surface })).getByRole("button", { name: "Copy PR number #2518" });
  const label = (element: Element) => document.getElementById(element.getAttribute("aria-describedby") ?? "")?.getAttribute("aria-label");
  try {
    await waitFor(() => expect(label(badge("left thread"))).toBe("Ready to merge"));
    await waitFor(() => expect(label(badge("left authored"))).toBe("Ready to merge"));
    // Cached paint is non-vacuous: all surfaces start with OPEN, then the actual summary resolves MERGED.
    const directoryBefore = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())!;
    await act(async () => { completeSummary(summary); });
    await waitFor(() => expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.facts[previousFact.key].state).toBe("merged"));
    for (const surface of ["left thread", "left authored"]) {
      await waitFor(() => expect(label(badge(surface))).toBe("Merged"));
      expect(badge(surface).getAttribute("data-tone")).toBe("merged");
      expect(badge(surface).querySelector("svg")?.getAttribute("data-icon")).toBe("GitMerge");
    }
    const right = within(slot.getByRole("region", { name: "right Changes" }));
    const mergedTitle = await right.findByText("#2518 Detailed sibling title");
    expect(mergedTitle.closest(".ws-stack-layer-item")?.querySelector('.ws-stack-state-icon[data-tone="merged"]')).toBeTruthy();
    expect(right.getByRole("button", { name: "Merged branch" }).hasAttribute("disabled")).toBe(true);
    expect(right.getByRole("button", { name: "Copy PR number #2531" })).toBeTruthy();
    fireEvent.click(right.getByRole("button", { name: "Show changed files for pull request #2518" }));
    fireEvent.click(await right.findByText("2518.ts"));
    await waitFor(() => expect(read).toHaveBeenCalledWith("getPullRequestFileDiff", expect.objectContaining({ pullRequestNumber: 2518, path: "2518.ts" })));
    expect(changesInteractionStore.getState().byThread.get("thr_current")?.selectedPullRequestNumber).toBe(2518);
    expect(projection.githubStack.stack.branches[0]).toMatchObject({ isCurrent: false, isMerged: false, hasStash: true, stashCount: 2, aheadOfRemote: 3 });
    const facts = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())!;
    expect(facts.facts[previousFact.key]).toMatchObject({ state: "merged", title: sibling.title, head: sibling.head, base: sibling.base, checks: previousFact.checks });
    expect(facts.observedAtByFact?.[previousFact.key]).toBe(directoryBefore.observedAtByFact?.[previousFact.key]);
    expect(resolvePullRequestFact(sibling, facts).state).toBe("merged");
    expect(read.mock.calls.filter(([method]) => method === "pullRequests")).toHaveLength(1);
  } finally { slot.lifecycle.unmount(); client.clear(); }
});
