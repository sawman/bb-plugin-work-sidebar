import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, waitFor, within } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { useRpc, type PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import { afterEach, expect, it, vi } from "vitest";
import { ChangesPanel } from "../../changes/panel";
import { ChangesCurrentPullRequestRow } from "../../changes/views";
import { changesInteractionStore } from "../../changes/store";
import { ThreadMetadata } from "../../threads/thread-row-presentation";
import { AuthoredPullRequestRow, AuthoredPullRequestStack } from "../authored-pull-requests";
import { useAuthoredPullRequests, useSharedThreadPullRequestDirectory, type PullRequestRpc } from "../queries";
import type { rpcContract } from "../../../contracts";
import type { PullRequestContract, PullRequestValidationDemands } from "../schemas";
import { currentPr } from "../../changes/tests/latency-fixtures";
import { prObservations } from "../../../tests/fixtures/pr-observation";

afterEach(() => { cleanup(); changesInteractionStore.setState({ byThread: new Map() }); });

const cases = [
  { label: "CI failure", tone: "destructive", icon: "X", checks: "failed", review: "approved", state: "open", attention: "checks_failed" },
  { label: "Checks pending", tone: "muted", icon: "LoaderCircle", checks: "pending", review: "approved", state: "open", attention: "checks_pending" },
  { label: "Review requested", tone: "warning", icon: "Eye", checks: "passing", review: "review_required", state: "open", attention: "review_requested" },
  { label: "Changes requested", tone: "closed", icon: "Wrench", checks: "passing", review: "changes_requested", state: "open", attention: "changes_requested" },
  { label: "Ready to merge", tone: "success", icon: "Check", checks: "passing", review: "approved", state: "open", attention: "ready_to_merge" },
  { label: "Approved", tone: "success", icon: "Check", checks: "unknown", review: "approved", state: "open", attention: "approved" },
  { label: "Draft", tone: "draft", icon: "GitPullRequest", checks: "passing", review: "approved", state: "draft", attention: "draft" },
  { label: "Closed", tone: "closed", icon: "X", checks: "passing", review: "approved", state: "closed", attention: "closed" },
  { label: "Merged", tone: "merged", icon: "GitMerge", checks: "passing", review: "approved", state: "merged", attention: "merged" },
  { label: "Conflicts", tone: "destructive", icon: "X", checks: "passing", review: "approved", state: "open", attention: "conflicts" },
  { label: "Queued to merge", tone: "warning", icon: "GitMerge", checks: "passing", review: "approved", state: "open", attention: "queued" },
] as const;

it.each(cases)("publishes $label consistently through thread/authored/Stack/Changes, and rejects later cached authored data", async (target) => {
  const client = new QueryClient();
  const subject = { ...currentPr(1, "Old title"), base: "feature/2", observations: prObservations(100),
    checks: { state: "pending" as const, totalCount: 1, failedCount: 0, pendingCount: 1, passedCount: 0 },
    review: { state: "none" as const, reviewRequestCount: 0 },
    signal: { checks: "pending" as const, review: "none" as const, reviewCommentCount: 0 } };
  const parent = { ...currentPr(2, "Parent"), observations: prObservations(100) };
  const light = (pr: typeof subject | typeof parent) => ({ ...pr, repository: "acme/repo", draft: false,
    checks: pr.signal.checks, review: pr.signal.review, reviewCommentCount: 0, stack: null });
  const stack = { id: "stack", number: 7, base: "main", currentPullRequest: 1, pullRequests: [light(parent), light(subject)] };
  const authored = [light(subject), { ...light(parent), stack }];
  const local = { pending: null, error: null, stack: { trunk: "main", currentBranch: parent.head, trunkBehind: 0, prunableBranchCount: 0,
    branches: [parent, subject].map((pr) => ({ name: pr.head, isCurrent: pr.number === 2, isMerged: false,
      isQueued: false, needsRebase: false, hasStash: true, stashCount: 2, aheadOfRemote: 3, behindRemote: 0,
      pr: { number: pr.number, url: pr.url, title: pr.title, state: "open", isDraft: false, metadataStale: false }, diff: null })) } };
  let complete!: () => void;
  const pending = new Promise<void>((resolve) => { complete = resolve; });
  let completeOldAuthored!: () => void;
  const oldAuthored = new Promise<void>((resolve) => { completeOldAuthored = resolve; });
  const read = vi.fn(async (method: string, input: { validationRequirements?: PullRequestValidationDemands }) => {
    switch (method) {
      case "pullRequests": return { env_subject: { outcome: "available", pullRequest: {
        number: 1, title: subject.title, url: subject.url, state: "open", checks: subject.checks, review: subject.review,
        mergeability: subject.mergeability, headRefName: subject.head, baseRefName: subject.base,
        updatedAt: "2026-10-26T00:00:00Z", autoMerge: false, inMergeQueue: null, attention: "checks_pending",
      } } };
      case "sidebarAuthoredPullRequests": return { available: true, pullRequests: authored, error: null };
      case "sidebarAuthoredPullRequestStacks": await oldAuthored; return { available: true, pullRequests: authored, error: null };
      case "getChangesRepository": return { outcome: "available", message: null, branch: parent.head, base: "main", ahead: 0, behind: 0,
        worktreeState: "clean", hasUncommittedChanges: false, changedFileCount: 0, changedInsertions: 0, changedDeletions: 0, changedFiles: [] };
      case "getChangesPullRequests": {
        await pending;
        const demand = input.validationRequirements?.["acme/repo#1"];
        const observations = Object.fromEntries(Object.entries(prObservations(200)).map(([group, clock]) => [group,
          { ...clock, ...(demand?.[group as keyof typeof demand] ? { satisfies: [demand[group as keyof typeof demand]] } : {}) }]));
        if (demand?.checks) observations.checkCounts = { ...observations.checkCounts!, satisfies: [demand.checks] };
        const final: PullRequestContract = { ...subject, observations, title: "Fresh title", state: target.state, attention: target.attention,
          checks: { state: target.checks === "failed" ? "failing" : target.checks, totalCount: 0, failedCount: 0, passedCount: 0, pendingCount: 0 },
          review: { state: target.review, reviewRequestCount: 0 },
          signal: { checks: target.checks, review: target.review, reviewCommentCount: 0 } };
        return { currentPullRequest: final, stack: { ...stack, pullRequests: [light(parent), { ...light(subject), ...final,
          checks: target.checks, review: target.review, draft: target.state === "draft", reviewCommentCount: 0 }] }, stackUnavailableReason: null };
      }
      case "getChangesProjection": return { currentPullRequest: subject, stack, stackUnavailableReason: null, githubStack: local };
      case "getChangesRemoteFiles": return { files: [] };
      case "getChangesFingerprint": return { fingerprint: "stable" };
      case "getSidebarAppearance": return {};
      case "getGitHubApiHealth": return { state: "available", scope: "unknown", message: null, retryAt: null };
      default: throw new Error(`Unexpected ${method}`);
    }
  });
  const methods = ["pullRequests", "sidebarAuthoredPullRequests", "sidebarAuthoredPullRequestStacks", "getChangesRepository",
    "getChangesPullRequests", "getChangesProjection", "getChangesRemoteFiles", "getChangesFingerprint", "getSidebarAppearance", "getGitHubApiHealth"];
  const rpc = Object.fromEntries(methods.map((method) => [method, (input: never) => read(method, input)]));
  function LeftSurfaces() {
    const transport = useRpc<typeof rpcContract>() as PullRequestRpc;
    const authoredQuery = useAuthoredPullRequests(transport);
    const directory = useSharedThreadPullRequestDirectory();
    const pr = directory.data.thr_subject;
    const root = authoredQuery.data?.find((entry) => entry.number === 1);
    const layers = authoredQuery.data?.find((entry) => entry.number === 2)?.stack;
    return <>
      <section aria-label="Thread"><ThreadMetadata thread={{ environment: { branchName: subject.head } } as PluginSidebarThread}
        projectLabel="Repo" pullRequest={pr ?? null} pullRequestLoading={false} /></section>
      <section aria-label="Authored root">{root && <AuthoredPullRequestRow pullRequest={root} changingDraft={false} onToggleDraft={vi.fn()} />}</section>
      <section aria-label="Authored Stack">{layers && <AuthoredPullRequestStack stack={layers} changingDraftUrl={null} onToggleDraft={vi.fn()} />}</section>
      <section aria-label="Changes current">{pr && <ChangesCurrentPullRequestRow pullRequest={pr} expanded={false} onToggle={vi.fn()} onOpenFile={vi.fn()} />}</section>
    </>;
  }
  function Content() {
    return <QueryClientProvider client={client}><LeftSurfaces /><section aria-label="Changes panel"><ChangesPanel threadId="thr_subject" environmentId="env_subject" /></section></QueryClientProvider>;
  }
  const slot = renderSlot({ component: Content }, {}, { rpc: rpc as never });
  const region = (name: string) => within(slot.getByRole("region", { name }));
  const badge = (name: string) => region(name).getByRole("button", { name: "Copy PR number #1" });
  const badgeLabel = (element: Element) => document.getElementById(element.getAttribute("aria-describedby") ?? "")?.getAttribute("aria-label");
  try {
    await waitFor(() => expect(badgeLabel(badge("Thread"))).toBe("Checks pending"));
    await waitFor(() => expect(region("Authored root").getByRole("article")).toBeTruthy());
    fireEvent.click(region("Authored Stack").getByRole("button", { name: "Expand stack layers" }));
    await act(async () => { complete(); });
    for (const surface of ["Thread", "Authored Stack", "Changes panel"]) {
      const stateBadge = badge(surface);
      await waitFor(() => expect(badgeLabel(stateBadge)).toBe(target.label));
      expect(stateBadge.getAttribute("data-tone")).toBe(target.tone);
      expect(stateBadge.querySelector("svg")?.getAttribute("data-icon")).toBe(target.icon);
    }
    for (const surface of ["Changes current", "Changes panel"]) {
      const row = region(surface).getByRole("button", { name: /#1 Fresh title/ }).closest(".ws-stack-layer-item")!;
      const status = row.querySelector(".ws-stack-state-icon")!;
      expect(status.getAttribute("aria-label")).toBe(target.label);
      expect(status.getAttribute("data-tone")).toBe(target.tone);
      expect(status.querySelector("svg")?.getAttribute("data-icon")).toBe(target.icon);
    }
    if (target.state === "closed" || target.state === "merged") expect(region("Authored root").queryByRole("article")).toBeNull();
    else expect(badgeLabel(badge("Authored root"))).toBe(target.label);
    const retainedLayer = badge("Authored Stack").closest("article")!;
    fireEvent.contextMenu(retainedLayer);
    const action = slot.getByRole("menuitem", { name: target.state === "draft" ? "Mark open" : "Mark draft" });
    expect(action.getAttribute("aria-disabled") === "true" || action.hasAttribute("disabled")).toBe(target.state === "closed" || target.state === "merged");
    fireEvent.keyDown(action, { key: "Escape" });
    await act(async () => { completeOldAuthored(); });
    await waitFor(() => expect(badgeLabel(badge("Thread"))).toBe(target.label));
    expect(region("Changes current").getByRole("button", { name: /#1 Fresh title/ })).toBeTruthy();
    expect(local.stack.branches[1]).toMatchObject({ isMerged: false, hasStash: true, stashCount: 2, aheadOfRemote: 3 });
  } finally { slot.lifecycle.unmount(); client.clear(); }
});
