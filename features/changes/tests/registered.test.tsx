// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { loadPluginApp, renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPluginQueryClient } from "../../../query-runtime";
import { changesInteractionStore } from "../store";

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const clipboardWrite = vi.fn(() => Promise.resolve());

const repository = (
  outcome: "available" | "absent" | "unavailable",
  dirty = false,
) => ({
  outcome,
  message: outcome === "available" ? null : "No repository",
  branch: outcome === "available" ? "main" : null,
  base: "main",
  ahead: 0,
  behind: 0,
  worktreeState: dirty ? "dirty_uncommitted" : "clean",
  hasUncommittedChanges: dirty,
  changedFileCount: dirty ? 3 : 0,
  changedInsertions: dirty ? 2 : 0,
  changedDeletions: dirty ? 1 : 0,
  changedFiles: dirty
    ? [
        { path: "renamed.ts", status: "renamed", insertions: 1, deletions: 1 },
        {
          path: "new.ts",
          status: "untracked",
          insertions: null,
          deletions: null,
        },
        { path: "old.ts", status: "deleted", insertions: 0, deletions: 1 },
      ]
    : [],
});
const context = {
  tasksAvailable: true,
  currentThread: {
    title: "Changes",
    status: "idle" as const,
    runtimeStatus: "idle",
    providerId: "codex",
  },
  tasks: [],
  subtasks: [],
  outcome: null,
  executionTasks: [],
  bindings: [],
  legacy: { state: "none" as const, taskIds: [], message: null },
  goal: null,
  todos: [],
  children: [],
};
type ChangesResult = {
  currentPullRequest: any;
  stack: any;
  stackUnavailableReason: null;
  githubStack: any;
  repository: ReturnType<typeof repository>;
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((next, fail) => {
    resolve = next;
    reject = fail;
  });
  return { promise, resolve, reject };
}
function changesResult(
  value = repository("available"),
  overrides: Partial<Omit<ChangesResult, "repository">> = {},
): ChangesResult {
  return {
    currentPullRequest: null,
    stack: null,
    stackUnavailableReason: null,
    githubStack: null,
    repository: value,
    ...overrides,
  };
}
type ChangesFixture = {
  getChanges: () => Promise<ChangesResult> | ChangesResult;
  getWorkContext?: () => typeof context;
  getWorkStatus?: () => unknown;
  getGitHubApiHealth?: () => unknown;
  githubHealth?: "available" | "rate_limited";
  checkoutStackBranch?: (input: {
    threadId: string;
    branch: string;
  }) => unknown;
  getWorkingTreeFileDiff?: (input: {
    threadId: string;
    path: string;
  }) => unknown;
  getPullRequestFileDiff?: (input: {
    threadId: string;
    pullRequestNumber: number;
    path: string;
  }) => unknown;
};
function rpc({
  getChanges,
  getWorkContext = () => context,
  getWorkStatus = () => ({
    currentThread: context.currentThread,
    children: [],
  }),
  githubHealth = "available",
  getGitHubApiHealth,
  checkoutStackBranch = () => ({
    ok: true,
    message: "Checked out",
    detail: null,
  }),
  getWorkingTreeFileDiff = ({ path }) => ({
    kind: "absent",
    path,
    patch: null,
    message: "No diff",
  }),
  getPullRequestFileDiff = ({ path }) => ({
    kind: "absent",
    path,
    patch: null,
    message: "No diff",
  }),
}: ChangesFixture) {
  return {
    getWorkContext,
    getChanges,
    getGitHubApiHealth:
      getGitHubApiHealth ??
      (() => ({
        state: githubHealth,
        scope: githubHealth === "available" ? "unknown" : "rest",
        message: githubHealth === "available" ? null : "limited",
        retryAt: null,
      })),
    getWorkProviderStatus: () => ({
      tone: "green",
      providerId: "codex",
      providerName: "Codex",
      statusUrl: null,
      status: "ready",
      message: null,
    }),
    getWorkTracker: () => ({
      visible: false,
      available: false,
      message: null,
      suggestions: [],
      items: [],
    }),
    getWorkStatus,
    getLatestActivity: () => ({
      currentThread: { status: "idle", runtimeStatus: "idle" },
      latest: null,
      lastUser: null,
      current: null,
    }),
    getWorkOutcome: () => ({
      tasksAvailable: true,
      outcome: null,
      executionTasks: [],
      bindings: [],
      legacy: { state: "none", taskIds: [], message: null },
    }),
    getWorkGoal: () => null,
    getWorkPlan: () => ({ items: [] }),
    getWorkBackgroundJobs: () => ({ items: [] }),
    checkoutStackBranch,
    getWorkingTreeFileDiff,
    getPullRequestFileDiff,
    sidebarTasks: () => ({
      available: true,
      tasks: [],
      projects: [],
      error: null,
    }),
    sidebarTaskLinks: () => ({ available: true, links: {}, error: null }),
  } as never;
}
async function changesSlot(fixture: ChangesFixture) {
  getPluginQueryClient().clear();
  const app = await loadPluginApp(() => import("../../../app"));
  const slot = renderSlot(
    app.threadPanelActions[0]!,
    { threadId: "thr_changes", params: null },
    { rpc: rpc(fixture) },
  );
  fireEvent.click(slot.getByRole("tab", { name: "Changes" }));
  return slot;
}
afterEach(() => {
  cleanup();
  getPluginQueryClient().clear();
  changesInteractionStore.setState({ byThread: new Map() });
  toast.success.mockReset();
  toast.error.mockReset();
  clipboardWrite.mockReset();
});

describe("R13 registered Changes Work slot", () => {
  it.each([
    ["clean", repository("available"), "Clean"],
    ["absent", repository("absent"), "Unavailable"],
    ["unavailable", repository("unavailable"), "Unavailable"],
  ] as const)("renders %s repository state", async (_name, value, label) => {
    const slot = await changesSlot({ getChanges: () => changesResult(value) });
    await waitFor(() => expect(slot.getByText(label)).toBeTruthy());
    slot.lifecycle.unmount();
  });
  it("renders loading, then retries a bounded Changes error while the Work sibling remains", async () => {
    const pending = deferred<ChangesResult>();
    let retry = false;
    const getChanges = vi.fn(() => (retry ? changesResult() : pending.promise));
    const slot = await changesSlot({ getChanges });
    await waitFor(() =>
      expect(
        slot.getByText("Loading pull requests and working-tree changes…"),
      ).toBeTruthy(),
    );
    expect(slot.getByRole("tab", { name: "Work" })).toBeTruthy();
    pending.reject(new Error("repository offline"));
    await waitFor(() => expect(slot.getByRole("alert")).toBeTruthy());
    expect(slot.getByRole("tab", { name: "Work" })).toBeTruthy();
    retry = true;
    fireEvent.click(
      slot.getByRole("button", { name: "Retry pull request changes" }),
    );
    await waitFor(() => expect(slot.getByText("Clean")).toBeTruthy());
    expect(getChanges).toHaveBeenCalledTimes(2);
    slot.lifecycle.unmount();
  });
  it("renders the non-stack Current PR and discloses stack branch files through the PR row", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: clipboardWrite },
    });
    const currentPullRequest = {
      number: 42,
      title: "Current PR",
      url: "https://github.com/acme/repo/pull/42",
      state: "open",
      head: "feature/current",
      base: "main",
      checks: {
        failedCount: 0,
        passedCount: 2,
        pendingCount: 0,
        state: "passing",
        totalCount: 2,
      },
      review: { reviewRequestCount: 0, state: "approved" },
      attention: "none",
      mergeability: {
        mergeStateStatus: "CLEAN",
        mergeable: "MERGEABLE",
        state: "mergeable",
      },
      signal: { checks: "passing", review: "approved", reviewCommentCount: 0 },
    };
    const nonStack = await changesSlot({
      getChanges: () =>
        changesResult(repository("available"), { currentPullRequest }),
    });
    await waitFor(() =>
      expect(nonStack.getByText(/#42 Current PR/)).toBeTruthy(),
    );
    const currentPrNumber = nonStack.getByRole("button", {
      name: "Copy PR number #42",
    });
    expect(currentPrNumber.classList.contains("ws-pr-number-badge")).toBe(true);
    expect(currentPrNumber.classList.contains("ws-identifier-badge")).toBe(true);
    fireEvent.click(currentPrNumber);
    await waitFor(() =>
      expect(clipboardWrite).toHaveBeenCalledWith("PR #42"),
    );
    const nonStackDisclosure = nonStack.getByRole("button", {
      name: "Show changed files for pull request #42",
    });
    expect(nonStackDisclosure.closest(".ws-stack-layer")).toBeTruthy();
    expect(
      (nonStack.getByRole("button", { name: "Current branch" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.click(nonStackDisclosure);
    expect(
      nonStack.getByText("Approved · 2 checks passed · Merge Mergeable"),
    ).toBeTruthy();
    expect(nonStack.getByText("Changed files are unavailable.")).toBeTruthy();
    nonStack.lifecycle.unmount();

    const branch = {
      name: "feature/stack",
      isCurrent: false,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      hasStash: false,
      stashCount: null,
      pr: {
        number: 43,
        url: "https://github.com/acme/repo/pull/43",
        state: "open",
        title: "Stack branch",
        isDraft: false,
        metadataStale: false,
      },
      diff: {
        additions: 2,
        deletions: 1,
        files: [
          {
            path: "renamed.ts",
            previousPath: "old.ts",
            status: "renamed",
            additions: 2,
            deletions: 1,
          },
        ],
        truncated: false,
      },
      aheadOfRemote: 0,
      behindRemote: 0,
      checks: "passing",
      review: "approved",
    };
    const getPullRequestFileDiff = vi.fn(({ path }: {
      threadId: string;
      pullRequestNumber: number;
      path: string;
    }) => ({
      kind: "patch",
      path,
      patch: "@@ -1 +1 @@\n-old\n+new",
      message: null,
    }));
    const stack = await changesSlot({
      getChanges: () =>
        changesResult(repository("available"), {
          stack: {
            number: 17,
            base: "main",
            currentPullRequest: 43,
            pullRequests: [],
          },
          githubStack: {
            stack: {
              trunk: "main",
              currentBranch: "feature/stack",
              branches: [branch],
              trunkBehind: 0,
              prunableBranchCount: 0,
            },
            pending: null,
            error: null,
          },
        }),
      getPullRequestFileDiff,
    });
    await waitFor(() =>
      expect(
        stack.getByRole("list", { name: "GitHub Stack based on main" }),
      ).toBeTruthy(),
    );
    const stackNumber = stack.getByLabelText("Copy stack number #17");
    expect(stackNumber.textContent).toBe("#17");
    expect(stackNumber.querySelector("svg")).toBeTruthy();
    const stackPrNumber = stack.getByRole("button", {
      name: "Copy PR number #43",
    });
    expect(stackPrNumber.textContent).toBe("#43");
    expect(stackPrNumber.compareDocumentPosition(stackNumber)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    const disclosure = stack.getByRole("button", {
      name: /#43 Stack branch.*Show changed files for pull request #43/,
    });
    const trailingDisclosure = stack.getByRole("button", {
      name: "Show changed files for pull request #43",
    });
    expect(disclosure.getAttribute("aria-expanded")).toBe("false");
    expect(trailingDisclosure.classList.contains("ws-stack-expand")).toBe(true);
    expect(
      trailingDisclosure.parentElement?.parentElement?.lastElementChild,
    ).toBe(trailingDisclosure.parentElement);
    fireEvent.keyDown(disclosure, { key: "Enter" });
    fireEvent.click(disclosure);
    expect(disclosure.getAttribute("aria-expanded")).toBe("true");
    expect(trailingDisclosure.getAttribute("aria-expanded")).toBe("true");
    expect(stack.getByText("renamed.ts")).toBeTruthy();
    expect(stack.getByLabelText("2 lines added").textContent).toBe("+2");
    expect(stack.getByLabelText("1 line deleted").textContent).toBe("−1");
    fireEvent.click(
      stack.getByRole("button", {
        name: "Open pull request diff for renamed.ts",
      }),
    );
    await waitFor(() =>
      expect(getPullRequestFileDiff).toHaveBeenCalledWith({
        threadId: "thr_changes",
        pullRequestNumber: 43,
        path: "renamed.ts",
      }),
    );
    const file = stack.getByRole("button", {
      name: "Open pull request diff for renamed.ts",
    });
    const close = stack.getByRole("button", {
      name: "Close diff for renamed.ts",
    });
    expect(file.compareDocumentPosition(close)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    stack.lifecycle.unmount();
  });

  it("treats a one-branch gh-stack projection as a standalone pull request with changed files", async () => {
    const currentPullRequest = {
      number: 1279,
      title: "Upgrade Pulumi",
      url: "https://github.com/acme/repo/pull/1279",
      state: "open",
      head: "deps/upgrade-pulumi",
      base: "main",
      checks: {
        failedCount: 1,
        passedCount: 99,
        pendingCount: 0,
        state: "failing",
        totalCount: 100,
      },
      review: { reviewRequestCount: 0, state: "changes_requested" },
      attention: "checks_failed",
      mergeability: {
        mergeStateStatus: "BLOCKED",
        mergeable: "MERGEABLE",
        state: "blocked",
      },
      signal: {
        checks: "failed",
        review: "changes_requested",
        reviewCommentCount: 0,
      },
    };
    const branch = {
      name: "deps/upgrade-pulumi",
      isCurrent: true,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      hasStash: false,
      stashCount: null,
      pr: {
        number: 1279,
        url: currentPullRequest.url,
        state: "open",
        title: currentPullRequest.title,
        isDraft: false,
        metadataStale: false,
      },
      diff: {
        additions: 382,
        deletions: 141,
        files: [
          {
            path: "infra/pyproject.toml",
            previousPath: null,
            status: "modified",
            additions: 1,
            deletions: 1,
          },
        ],
        truncated: true,
      },
      aheadOfRemote: 0,
      behindRemote: 0,
      checks: "failed",
      review: "changes_requested",
    };
    const slot = await changesSlot({
      getChanges: () =>
        changesResult(repository("available"), {
          currentPullRequest,
          stack: null,
          githubStack: {
            stack: {
              trunk: "main",
              currentBranch: branch.name,
              branches: [branch],
              trunkBehind: 0,
              prunableBranchCount: 0,
            },
            pending: null,
            error: null,
          },
        }),
    });

    await waitFor(() =>
      expect(slot.getByText(/#1279 Upgrade Pulumi/)).toBeTruthy(),
    );
    expect(
      slot.queryByRole("list", { name: "GitHub Stack based on main" }),
    ).toBeNull();
    const disclosure = slot.getByRole("button", {
      name: "Show changed files for pull request #1279",
    });
    const row = disclosure.closest(".ws-stack-layer");
    expect(row).toBeTruthy();
    expect(slot.container.querySelector(".ws-current-pr-card")).toBeNull();
    expect(row?.querySelectorAll(".ws-stack-action-slot")).toHaveLength(3);
    expect(
      (slot.getByRole("button", { name: "Current branch" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(disclosure.querySelector("svg path")?.getAttribute("d")).toBe(
      "m9 18 6-6-6-6",
    );
    fireEvent.click(disclosure);
    expect(
      slot
        .getByRole("button", {
          name: "Hide changed files for pull request #1279",
        })
        .querySelector("svg path")
        ?.getAttribute("d"),
    ).toBe("m6 9 6 6 6-6");
    expect(slot.getByText("infra/pyproject.toml")).toBeTruthy();
    expect(slot.getByLabelText("1 line added").textContent).toBe("+1");
    expect(slot.getByLabelText("1 line deleted").textContent).toBe("−1");
    slot.lifecycle.unmount();
  });
  it("refreshes Changes exactly once without calling the legacy aggregate on manual refresh", async () => {
    const getChanges = vi.fn(() => changesResult());
    const getWorkContext = vi.fn(() => context);
    const getGitHubApiHealth = vi.fn(() => ({
      state: "available",
      scope: "unknown",
      message: null,
      retryAt: null,
    }));
    const slot = await changesSlot({
      getChanges,
      getWorkContext,
      getGitHubApiHealth,
    });
    await waitFor(() => expect(getChanges).toHaveBeenCalledTimes(1));
    expect(getWorkContext).not.toHaveBeenCalled();
    fireEvent.click(slot.getByRole("button", { name: "Refresh work context" }));
    await waitFor(() => expect(getChanges).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(getGitHubApiHealth).toHaveBeenCalledTimes(2));
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getWorkContext).not.toHaveBeenCalled();
    slot.lifecycle.unmount();
  });
  it("invalidates only the matching Changes thread and family", async () => {
    const getChanges = vi.fn(() => changesResult());
    const getWorkContext = vi.fn(() => context);
    const slot = await changesSlot({ getChanges, getWorkContext });
    await waitFor(() => expect(getChanges).toHaveBeenCalledTimes(1));
    expect(getWorkContext).not.toHaveBeenCalled();
    await slot.behavior.emitRealtime("work-sidebar:changed", {
      family: "changes",
      threadId: "thr_other",
    });
    expect(getChanges).toHaveBeenCalledTimes(1);
    await slot.behavior.emitRealtime("work-sidebar:changed", {
      family: "work",
      threadId: "thr_changes",
    });
    expect(getChanges).toHaveBeenCalledTimes(1);
    await slot.behavior.emitRealtime("work-sidebar:changed", {
      family: "changes",
      threadId: "thr_changes",
    });
    await waitFor(() => expect(getChanges).toHaveBeenCalledTimes(2));
    expect(getChanges).toHaveBeenCalledTimes(2);
    expect(getWorkContext).not.toHaveBeenCalled();
    slot.lifecycle.unmount();
  });
  it("renders Changes when the Work status query fails", async () => {
    const getChanges = vi.fn(() => changesResult(repository("available")));
    const getWorkStatus = vi.fn(() =>
      Promise.reject(new Error("Work unavailable")),
    );
    const slot = await changesSlot({ getChanges, getWorkStatus });
    await waitFor(() => expect(slot.getByText("Clean")).toBeTruthy());
    expect(slot.getByRole("tabpanel").textContent).toContain("Changes");
    expect(getChanges).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
  });
  it("renders clean and dirty repository states through the registered panel and preserves global health", async () => {
    const getChanges = vi.fn(() =>
      changesResult(repository("available", true)),
    );
    const slot = await changesSlot({
      getChanges,
      getGitHubApiHealth: () => ({
        state: "rate_limited",
        scope: "graphql",
        message: "GitHub GraphQL is rate limited; using REST where possible.",
        retryAt: null,
        limits: {
          graphql: { limit: 5_000, remaining: 0, resetAt: null },
          rest: { limit: 5_000, remaining: 4_812, resetAt: null },
        },
      }),
    });
    await waitFor(() => expect(slot.getByText("Changed")).toBeTruthy());
    fireEvent.click(
      slot.getByRole("button", { name: "Show 3 working-tree files" }),
    );
    expect(slot.getByText("renamed.ts")).toBeTruthy();
    expect(slot.getByText("new.ts")).toBeTruthy();
    expect(slot.getByText("old.ts")).toBeTruthy();
    expect(
      slot.getByText("GraphQL limited · GQL 0/5,000 · REST 4,812/5,000"),
    ).toBeTruthy();
    expect(slot.getByTitle(/GraphQL 0\/5,000.*REST 4,812\/5,000/)).toBeTruthy();
    expect(getChanges).toHaveBeenCalledTimes(1);
    slot.lifecycle.unmount();
  });
  it("keeps checkout busy through success and failure, and lazily opens/closes isolated file previews", async () => {
    const checkout = deferred<{
      ok: boolean;
      message: string;
      tone?: "success" | "warning" | "error";
      detail: null;
    }>();
    let shouldFailCheckout = false;
    const getWorkingTreeFileDiff = vi.fn(({ path }: { path: string }) => ({
      kind: "binary" as const,
      path,
      patch: null,
      message: "This binary file cannot be shown as a text diff.",
    }));
    const branch = {
      name: "feature/checkout",
      isCurrent: false,
      isMerged: false,
      isQueued: false,
      needsRebase: false,
      hasStash: false,
      stashCount: null,
      pr: null,
      diff: { additions: 1, deletions: 0, files: [], truncated: false },
      aheadOfRemote: 0,
      behindRemote: 0,
    };
    const slot = await changesSlot({
      getChanges: () =>
        changesResult(repository("available", true), {
          stack: {
            number: 72,
            base: "main",
            currentPullRequest: 0,
            pullRequests: [],
          },
          githubStack: {
            stack: {
              trunk: "main",
              currentBranch: "main",
              branches: [branch],
              trunkBehind: 0,
              prunableBranchCount: 0,
            },
            pending: null,
            error: null,
          },
        }),
      checkoutStackBranch: () =>
        shouldFailCheckout
          ? {
              ok: false,
              message: "Checkout blocked",
              tone: "error",
              detail: null,
            }
          : checkout.promise,
      getWorkingTreeFileDiff,
    });

    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Check out feature/checkout" }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Check out feature/checkout" }),
    );
    await waitFor(() =>
      expect(
        slot
          .getByRole("button", { name: "Checking out feature/checkout" })
          .hasAttribute("disabled"),
      ).toBe(true),
    );
    checkout.resolve({ ok: true, message: "Checked out", detail: null });
    await waitFor(() =>
      expect(toast.success).toHaveBeenCalledWith("Checked out"),
    );
    shouldFailCheckout = true;
    fireEvent.click(
      slot.getByRole("button", { name: "Check out feature/checkout" }),
    );
    await waitFor(() =>
      expect(toast.error).toHaveBeenCalledWith("Checkout blocked"),
    );
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "checkoutStackBranch",
      ),
    ).toHaveLength(2);

    fireEvent.click(
      slot.getByRole("button", { name: /(?:Show|Hide) 3 working-tree files/ }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open uncommitted diff for renamed.ts",
      }),
    );
    await waitFor(() =>
      expect(getWorkingTreeFileDiff).toHaveBeenCalledWith({
        threadId: "thr_changes",
        path: "renamed.ts",
      }),
    );
    await waitFor(() =>
      expect(
        slot.getByText("This binary file cannot be shown as a text diff."),
      ).toBeTruthy(),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Close diff for renamed.ts" }),
    );
    expect(
      slot.queryByRole("button", { name: "Close diff for renamed.ts" }),
    ).toBeNull();
    slot.lifecycle.unmount();
  });

  it("clears an opened file selection on panel unmount without disturbing another thread", async () => {
    const getWorkingTreeFileDiff = vi.fn(({ path }: { path: string }) => ({
      kind: "binary" as const,
      path,
      patch: null,
      message: "This binary file cannot be shown as a text diff.",
    }));
    const fixture = {
      getChanges: () => changesResult(repository("available", true)),
      getWorkingTreeFileDiff,
    };
    const slot = await changesSlot(fixture);
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Show 3 working-tree files" }),
      ).toBeTruthy(),
    );
    fireEvent.click(
      slot.getByRole("button", { name: "Show 3 working-tree files" }),
    );
    fireEvent.click(
      slot.getByRole("button", {
        name: "Open uncommitted diff for renamed.ts",
      }),
    );
    await waitFor(() =>
      expect(
        slot.getByRole("button", { name: "Close diff for renamed.ts" }),
      ).toBeTruthy(),
    );
    changesInteractionStore.getState().selectFile("thr_other", "other.ts");

    slot.lifecycle.unmount();
    expect(
      changesInteractionStore.getState().byThread.get("thr_changes")
        ?.selectedFilePath,
    ).toBeNull();
    expect(
      changesInteractionStore.getState().byThread.get("thr_other")
        ?.selectedFilePath,
    ).toBe("other.ts");

    const remounted = await changesSlot(fixture);
    await waitFor(() => expect(remounted.getByText("Changed")).toBeTruthy());
    expect(
      remounted.queryByRole("button", { name: "Close diff for renamed.ts" }),
    ).toBeNull();
    remounted.lifecycle.unmount();
  });
});
