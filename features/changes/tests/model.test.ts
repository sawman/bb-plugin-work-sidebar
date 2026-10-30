import { describe, expect, it } from "vitest";
import {
  changesHeaderLabel,
  mergeStackBranchSignals,
  repositoryPresentation,
} from "../model";
import {
  factFromThreadPullRequest,
  mergePullRequestFacts,
} from "../../pull-requests/facts";
import { currentPr } from "./latency-fixtures";

describe("R13 Changes model", () => {
  it.each(["same-head-different-number", "same-number-different-repository"])("does not promote a different merged PR identity: %s", (shape) => {
    const sibling = currentPr(2518);
    const current = currentPr(2531);
    const layer = { ...sibling, number: shape === "same-head-different-number" ? 2500 : sibling.number,
      url: shape === "same-head-different-number" ? "https://github.com/acme/repo/pull/2500" : "https://github.com/other/repo/pull/2518",
      state: "merged", draft: false, checks: "passing" as const, review: "approved" as const, reviewCommentCount: 0 };
    const branch = { name: sibling.head, isCurrent: false, isMerged: false, isQueued: false, needsRebase: false,
      hasStash: false, stashCount: null, diff: null, aheadOfRemote: 0, behindRemote: 0,
      pr: { number: sibling.number, url: sibling.url, state: sibling.state, title: sibling.title, isDraft: false, metadataStale: false } };
    const facts = mergePullRequestFacts(undefined, [factFromThreadPullRequest({ ...sibling, stackNumber: 7 })]);
    const resolved = mergeStackBranchSignals(branch, { currentPullRequest: current,
      stack: { number: 7, base: "main", currentPullRequest: 2531, pullRequests: [layer] }, stackUnavailableReason: null, githubStack: null }, current, facts);
    expect(resolved?.state).toBe("open");
  });

  it("resolves a merged sibling summary before an older detailed OPEN fact without changing local flags", () => {
    const sibling = currentPr(2518, "Detailed title");
    const current = currentPr(2531);
    const facts = mergePullRequestFacts(undefined, [factFromThreadPullRequest({ ...sibling, stackNumber: 7 })]);
    const branch = {
      name: sibling.head, isCurrent: false, isMerged: false, isQueued: true, needsRebase: false,
      hasStash: true, stashCount: 2, diff: null, aheadOfRemote: 3, behindRemote: 0,
      pr: { number: sibling.number, url: sibling.url, title: sibling.title, state: "open", isDraft: false, metadataStale: false },
    };
    const layer = { ...sibling, title: "Old topology title", state: "merged", draft: false,
      checks: "passing" as const, review: "approved" as const, reviewCommentCount: 0 };
    const resolved = mergeStackBranchSignals(branch, { currentPullRequest: current,
      stack: { number: 7, base: "main", currentPullRequest: 2531, pullRequests: [layer] }, stackUnavailableReason: null, githubStack: null }, current, facts);
    expect(resolved).toMatchObject({ state: "merged", draft: false, title: "Detailed title", checks: "passing", review: "approved" });
    expect(branch).toMatchObject({ isCurrent: false, isMerged: false, isQueued: true, hasStash: true, stashCount: 2, aheadOfRemote: 3 });
    expect(current.number).toBe(2531);
  });

  it("distinguishes clean, dirty, absent, and unavailable repositories and retains renamed, untracked, and deleted files", () => {
    const base = {
      outcome: "available" as const,
      message: null,
      branch: "main",
      base: "origin/main",
      ahead: 0,
      behind: 0,
      worktreeState: "clean",
      hasUncommittedChanges: false,
      changedFileCount: 0,
      changedInsertions: 0,
      changedDeletions: 0,
      changedFiles: [],
    };
    expect(repositoryPresentation(base)).toMatchObject({ label: "Clean" });
    expect(
      repositoryPresentation({
        ...base,
        hasUncommittedChanges: true,
        changedFileCount: 3,
        changedFiles: [
          {
            path: "renamed.ts",
            status: "renamed",
            insertions: 1,
            deletions: 1,
          },
          {
            path: "new.ts",
            status: "untracked",
            insertions: null,
            deletions: null,
          },
          { path: "old.ts", status: "deleted", insertions: 0, deletions: 2 },
        ],
      }),
    ).toMatchObject({ label: "Changed" });
    expect(
      repositoryPresentation({ ...base, outcome: "absent", branch: null }),
    ).toMatchObject({ label: "Unavailable" });
    expect(
      repositoryPresentation({ ...base, outcome: "unavailable", branch: null }),
    ).toMatchObject({ label: "Unavailable" });
  });
  it("projects stack and non-stack headings without hiding a usable repository", () => {
    expect(
      changesHeaderLabel({ currentPullRequest: null } as never, false, false),
    ).toBe("No PR");
    expect(
      changesHeaderLabel(
        { currentPullRequest: { number: 7 } } as never,
        false,
        false,
      ),
    ).toBe("#7");
  });

  it("merges current-PR and stack signals with typed branch-local precedence", () => {
    const branch = {
      name: "feature/one",
      isCurrent: true,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      hasStash: false,
      stashCount: null,
      pr: {
        number: 7,
        url: "https://github.com/acme/repo/pull/7",
        state: "open",
        title: "One",
        isDraft: false,
        metadataStale: false,
      },
      diff: null,
      aheadOfRemote: 0,
      behindRemote: 0,
      checks: "passing",
      review: "approved",
    } as const;
    const changes = {
      currentPullRequest: {
        number: 7,
        url: "https://github.com/acme/repo/pull/7",
        title: "One",
        attention: "checks_failed",
        state: "open",
        signal: {
          checks: "failed",
          review: "changes_requested",
          reviewCommentCount: 2,
        },
      },
      stack: {
        pullRequests: [
          {
            number: 7,
            url: "https://github.com/acme/repo/pull/7",
            head: "feature/one",
            state: "open",
            draft: false,
            checks: "passing",
            review: "approved",
            approvers: ["reviewer-b"],
            changeRequesters: ["reviewer-a"],
            requestedReviewers: ["reviewer-a"],
            reviewCommentCount: 1,
          },
        ],
      },
    };
    expect(mergeStackBranchSignals(branch, changes as never)).toEqual({
      number: 7,
      url: "https://github.com/acme/repo/pull/7",
      title: "One",
      attention: "checks_failed",
      head: "feature/one",
      state: "open",
      draft: false,
      checks: "failed",
      review: "changes_requested",
      approvers: ["reviewer-b"],
      changeRequesters: ["reviewer-a"],
      requestedReviewers: ["reviewer-a"],
      reviewCommentCount: 2,
    });
  });

  it("reads the shared PR fact before its local stack fallback", () => {
    const branch = {
      name: "feature/one",
      isCurrent: true,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      hasStash: false,
      stashCount: null,
      pr: {
        number: 1402,
        url: "https://github.com/example-org/example-repo/pull/1402",
        state: "open",
        title: "Review lifecycle",
        isDraft: false,
        metadataStale: false,
      },
      diff: null,
      aheadOfRemote: 0,
      behindRemote: 0,
      checks: "passing",
      review: "changes_requested",
    } as const;
    const facts = mergePullRequestFacts(undefined, [
      factFromThreadPullRequest({
        number: 1402,
        title: "Review lifecycle",
        url: "https://github.com/example-org/example-repo/pull/1402",
        state: "open",
        head: "feature/one",
        base: "main",
        checks: {
          failedCount: 0,
          passedCount: 2,
          pendingCount: 0,
          state: "passing",
          totalCount: 2,
        },
        review: { reviewRequestCount: 1, state: "review_required" },
        attention: "review_requested",
        mergeability: {
          mergeStateStatus: "CLEAN",
          mergeable: "MERGEABLE",
          state: "mergeable",
        },
        signal: {
          checks: "passing",
          review: "review_required",
          changeRequesters: ["reviewer-a"],
          requestedReviewers: ["reviewer-a"],
          reviewCommentCount: 2,
        },
        stackNumber: 17,
      }),
    ]);
    expect(
      mergeStackBranchSignals(
        branch,
        { currentPullRequest: null, stack: null } as never,
        undefined,
        facts,
      ),
    ).toMatchObject({
      review: "review_required",
      requestedReviewers: ["reviewer-a"],
    });
  });
});
