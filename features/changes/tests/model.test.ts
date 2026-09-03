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

describe("R13 Changes model", () => {
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
            head: "feature/one",
            state: "open",
            draft: false,
            checks: "passing",
            review: "approved",
            approvers: ["hendra-systemearth"],
            changeRequesters: ["yojo-se"],
            requestedReviewers: ["yojo-se"],
            reviewCommentCount: 1,
          },
        ],
      },
    };
    expect(mergeStackBranchSignals(branch, changes as never)).toEqual({
      number: 7,
      head: "feature/one",
      state: "open",
      draft: false,
      checks: "failed",
      review: "changes_requested",
      approvers: ["hendra-systemearth"],
      changeRequesters: ["yojo-se"],
      requestedReviewers: ["yojo-se"],
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
        url: "https://github.com/SystemEarth/systemearth/pull/1402",
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
        url: "https://github.com/SystemEarth/systemearth/pull/1402",
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
          changeRequesters: ["yojo-se"],
          requestedReviewers: ["yojo-se"],
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
      requestedReviewers: ["yojo-se"],
    });
  });
});
