import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { renderSlot } from "@get-bb/plugin-sdk/testing/app";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useNativeThreadPullRequest } from "../native-status-queries";
import { pullRequestKeys, hydratePullRequestFacts, useSharedPullRequestFactDirectory } from "../queries";
import { factFromPullRequest, type PullRequestFactDirectory } from "../facts";
import { projectNativePullRequest } from "../native-status-queries";
import type { PullRequest, EnvironmentPullRequest } from "../native-status-schemas";

function nativePr(number = 1): PullRequest {
  return { number, title: `Native ${number}`, url: `https://github.com/acme/repo/pull/${number}`, state: "open",
    headRefName: `feature/${number}`, baseRefName: "main", updatedAt: "2026-10-26T00:00:00Z", autoMerge: false, inMergeQueue: null,
    checks: { state: "passing", totalCount: 1, passedCount: 1, failedCount: 0, pendingCount: 0 },
    review: { state: "approved", reviewRequestCount: 0 }, attention: "ready_to_merge",
    mergeability: { state: "mergeable", mergeStateStatus: "CLEAN", mergeable: "MERGEABLE" } };
}
function Probe({ threadId, environmentId, label }: { threadId: string; environmentId: string; label: string }) {
  const native = useNativeThreadPullRequest(threadId, environmentId);
  const facts = useSharedPullRequestFactDirectory();
  return <section aria-label={label}>
    <output aria-label={`${label} status`}>{native.error ?? native.pullRequest?.title ?? native.row?.outcome ?? "loading"}</output>
    <output aria-label={`${label} fact`}>{Object.values(facts.data?.facts ?? {}).map((fact) => fact.title).join(",")}</output>
    <button onClick={() => void native.refetch()}>Retry {label}</button>
  </section>;
}
afterEach(cleanup);

describe("installed SDK keyed PR boundary", () => {
  it("coalesces left/right opt-in reads and publishes native invalidation into the one shared fact directory", async () => {
    const client = new QueryClient();
    const enriched = factFromPullRequest(projectNativePullRequest(nativePr()));
    enriched.signal = { ...enriched.signal, approvers: ["reviewer"], reviewCommentCount: 5,
      reviewCommentCounts: { unresolved: 2, resolved: 3 } };
    hydratePullRequestFacts(client, [enriched], { thr_a: enriched.key });
    let row: EnvironmentPullRequest = { outcome: "available", pullRequest: nativePr() };
    const read = vi.fn(async () => ({ env_shared: row }));
    const Content = () => <QueryClientProvider client={client}>
      <Probe label="left" threadId="thr_a" environmentId="env_shared" />
      <Probe label="right" threadId="thr_a" environmentId="env_shared" />
    </QueryClientProvider>;
    const slot = renderSlot({ component: Content }, {}, { rpc: { pullRequests: read } });
    try {
      await waitFor(() => expect(slot.getByLabelText("right fact").textContent).toBe("Native 1"));
      expect(read).toHaveBeenCalledOnce();
      expect(read).toHaveBeenCalledWith({ keys: ["env_shared"] });
      expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.facts[enriched.key].signal)
        .toMatchObject({ approvers: ["reviewer"], reviewCommentCount: 5, reviewCommentCounts: { unresolved: 2, resolved: 3 } });
      row = { outcome: "available", pullRequest: { ...nativePr(), title: "Fresh", state: "merged", attention: "merged" } };
      await slot.behavior.experimental_invalidateRpc(["environment:env_shared"], "bb--github-pr-status");
      await waitFor(() => expect(slot.getByLabelText("left status").textContent).toBe("Fresh"));
      await waitFor(() => expect(slot.getByLabelText("right fact").textContent).toBe("Fresh"));
      const facts = client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory());
      expect(facts?.facts["acme/repo#1"].state).toBe("merged");
      expect(read).toHaveBeenCalledTimes(2);
    } finally { slot.lifecycle.unmount(); client.clear(); }
  });

  it.each(["unavailable", "omitted", "malformed", "disabled"])("keeps %s separate from absence, isolates valid rows and retries through the real hook", async (kind) => {
    const client = new QueryClient();
    const environmentId = `env_${kind}`;
    const oldFact = factFromPullRequest(projectNativePullRequest(nativePr(2)));
    hydratePullRequestFacts(client, [oldFact], { thr_error: oldFact.key });
    let retry = false;
    const read = vi.fn(async () => {
      if (!retry && kind === "disabled") throw new Error("Native plugin disabled");
      return {
        env_valid: { outcome: "available", pullRequest: nativePr(3) },
        ...(retry ? { [environmentId]: { outcome: "absent" } }
          : kind === "omitted" ? {}
          : { [environmentId]: kind === "malformed" ? { outcome: "absent", unexpected: true }
            : { outcome: "unavailable", message: "Machine offline" } }),
      };
    });
    const Content = () => <QueryClientProvider client={client}>
      <Probe label="failed" threadId="thr_error" environmentId={environmentId} />
      <Probe label="valid" threadId="thr_valid" environmentId="env_valid" />
    </QueryClientProvider>;
    const slot = renderSlot({ component: Content }, {}, { rpc: { pullRequests: read } });
    try {
      await waitFor(() => expect(slot.getByLabelText("failed status").textContent).toMatch(/offline|omitted|invalid|disabled/i));
      expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.threadFactKeys.thr_error).toBe(oldFact.key);
      if (kind === "omitted") {
        // SDK0.6.79 rejects an incomplete keyed batch before publishing any new rows.
        expect(slot.getByLabelText("valid status").textContent).toMatch(/omitted/);
      } else if (kind !== "disabled") expect(slot.getByLabelText("valid status").textContent).toBe("Native 3");
      const beforeRetry = read.mock.calls.length;
      expect(beforeRetry).toBe(1);
      retry = true;
      fireEvent.click(slot.getByRole("button", { name: "Retry failed" }));
      await waitFor(() => expect(slot.getByLabelText("failed status").textContent).toBe("absent"));
      await waitFor(() => expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.threadFactKeys.thr_error).toBeUndefined());
      expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.threadFactKeys.thr_valid).toBe("acme/repo#3");
      expect(read).toHaveBeenCalledTimes(beforeRetry + 1);
    } finally { slot.lifecycle.unmount(); client.clear(); }
  });

  it("changes thread/environment scope and ignores late unmounted data without a second cache", async () => {
    const client = new QueryClient();
    let complete!: (value: unknown) => void;
    const slow = new Promise((resolve) => { complete = resolve; });
    const read = vi.fn(async ({ keys }: { keys: string[] }) => keys.includes("env_old") ? slow : { env_next: { outcome: "available", pullRequest: nativePr(4) } });
    const Content = () => {
      const [next, setNext] = useState(false);
      return <QueryClientProvider client={client}>
        <button onClick={() => setNext(true)}>Switch thread</button>
        <Probe label="current" threadId={next ? "thr_next" : "thr_old"} environmentId={next ? "env_next" : "env_old"} />
      </QueryClientProvider>;
    };
    const slot = renderSlot({ component: Content }, {}, { rpc: { pullRequests: read } });
    await waitFor(() => expect(read).toHaveBeenCalledWith({ keys: ["env_old"] }));
    fireEvent.click(slot.getByRole("button", { name: "Switch thread" }));
    complete({ env_old: { outcome: "available", pullRequest: nativePr(5) } });
    await waitFor(() => expect(slot.getByLabelText("current status").textContent).toBe("Native 4"));
    expect(client.getQueryData<PullRequestFactDirectory>(pullRequestKeys.factDirectory())?.threadFactKeys.thr_old).toBeUndefined();
    slot.lifecycle.unmount();
    const count = read.mock.calls.length;
    await slot.behavior.experimental_invalidateRpc(null, "bb--github-pr-status");
    expect(read).toHaveBeenCalledTimes(count);
    client.clear();
  });
});
