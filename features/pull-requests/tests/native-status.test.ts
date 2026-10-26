import { describe, expect, it, vi } from "vitest";
import { createThreadStackService } from "../server-thread-stack";
import { createServerLifecycle } from "../../../server-lifecycle";
import { nativeStatusContract } from "../native-status-schemas";
import { z } from "zod";
import inspectedContract from "../../../tests/fixtures/native-status-rpc-schema.json";

function fixture(run: (request: any) => Promise<any>) {
  const callRpc = vi.fn(run);
  const bb = { sdk: {
    threads: { get: vi.fn(async ({ threadId }: { threadId: string }) => ({ environmentId: threadId.replace("thr_", "env_") })) },
    environments: {}, plugins: { callRpc },
  } };
  const lifecycle = createServerLifecycle();
  const service = createThreadStackService(bb as never, lifecycle, vi.fn(async () => "[]"));
  return { bb, callRpc, lifecycle, service };
}

describe("native PR provider migration", () => {
  it("matches all four installed provider wire schemas, and action scopes", () => {
    for (const method of inspectedContract) {
      const local = nativeStatusContract[method.method as keyof typeof nativeStatusContract];
      expect(z.toJSONSchema(local.input)).toEqual(method.inputSchema);
      expect(z.toJSONSchema(local.output)).toEqual(method.outputSchema);
    }
  });
  it("reads an absent PR through the installed keyed plugin at the Changes summary boundary", async () => {
    const callRpc = vi.fn(async () => ({ env_a: { outcome: "absent" } }));
    const bb = { sdk: {
      threads: { get: async () => ({ environmentId: "env_a" }) },
      environments: {},
      plugins: { callRpc },
    } };
    const lifecycle = createServerLifecycle();
    const service = createThreadStackService(bb as never, lifecycle, vi.fn(async () => "[]"));
    try {
      await expect(service.summary("thr_a")).resolves.toMatchObject({ currentPullRequest: null });
      expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({
        pluginId: "bb--github-pr-status", method: "pullRequests", input: { keys: ["env_a"] },
      }));
    } finally { lifecycle.dispose(); }
  });

  it.each([
    ["unavailable", { env_a: { outcome: "unavailable", message: "Machine offline" } }, "Machine offline"],
    ["missing row", {}, "omitted this environment"],
  ])("keeps %s separate from confirmed absence in summary and scoped directory", async (_label, rows, message) => {
    const { service, lifecycle } = fixture(async () => rows);
    try {
      await expect(service.summary("thr_a")).rejects.toThrow(String(message));
      await expect(service.sidebarThreadPullRequests({ threadIds: ["thr_a"] })).resolves.toMatchObject({ available: false, pullRequests: {} });
    } finally { lifecycle.dispose(); }
  });

  it("missing/disabled plugin fails independently, retries without retaining failure, and local stack survives", async () => {
    let online = false;
    const { service, lifecycle, callRpc } = fixture(async ({ pluginId, input, outputSchema }) => {
      if (pluginId === "gh-stack") return { stack: { trunk: "main", currentBranch: "local", branches: [], trunkBehind: 2, prunableBranchCount: 0 }, pending: null, error: null, fetchedAt: 1 };
      if (!online) throw new Error("Plugin bb--github-pr-status is disabled");
      return outputSchema.parse(Object.fromEntries(input.keys.map((key: string) => [key, { outcome: "absent" }])));
    });
    try {
      await expect(service.summary("thr_a")).rejects.toThrow("disabled");
      const projection = await service.projection("thr_a");
      expect(projection.githubStack?.stack).toMatchObject({ currentBranch: "local", trunkBehind: 2 });
      expect(projection.stackUnavailableReason).toContain("disabled");
      online = true;
      await expect(service.summary("thr_a")).resolves.toMatchObject({ currentPullRequest: null });
      expect(callRpc.mock.calls.filter(([request]) => request.pluginId === "bb--github-pr-status")).toHaveLength(3);
    } finally { lifecycle.dispose(); }
  });

  it("reads available native state without an old environment method and preserves the typed request scope", async () => {
    const pullRequest = {
      number: 2, title: "Native", url: "https://example.com/pull/2", state: "merged",
      headRefName: "feature", baseRefName: "main", updatedAt: "2026-10-26T00:00:00Z", autoMerge: false, inMergeQueue: null,
      checks: { state: "failing", totalCount: 1, passedCount: 0, failedCount: 1, pendingCount: 0 },
      review: { state: "changes_requested", reviewRequestCount: 0 },
      mergeability: { state: "unknown", mergeStateStatus: null, mergeable: null }, attention: "merged",
    };
    const { service, lifecycle, callRpc } = fixture(async ({ input, outputSchema }) => outputSchema.parse({ [input.keys[0]]: { outcome: "available", pullRequest } }));
    try {
      expect((await service.summary("thr_a")).currentPullRequest).toMatchObject({ number: 2, state: "merged", signal: { checks: "failed", review: "changes_requested" } });
      expect((await service.summary("thr_b")).currentPullRequest?.number).toBe(2);
      expect(callRpc.mock.calls.map(([request]) => request.input)).toEqual([{ keys: ["env_a"] }, { keys: ["env_b"] }]);
    } finally { lifecycle.dispose(); }
  });

  it("does not publish a late native read after disposal", async () => {
    let complete!: (rows: unknown) => void;
    const pending = new Promise((resolve) => { complete = resolve; });
    const { service, lifecycle, callRpc } = fixture(async () => pending);
    const read = service.summary("thr_a");
    await vi.waitFor(() => expect(callRpc).toHaveBeenCalledOnce());
    lifecycle.dispose(); complete({ env_a: { outcome: "absent" } });
    await expect(read).rejects.toThrow("disposed");
    await expect(service.summary("thr_a")).rejects.toThrow("disposed");
    expect(callRpc).toHaveBeenCalledOnce();
  });

  it("matches keyed read limits and native action scope/tags", () => {
    expect(nativeStatusContract.pullRequests.input.safeParse({ keys: [] }).success).toBe(false);
    expect(nativeStatusContract.pullRequests.input.safeParse({ keys: Array(201).fill("env") }).success).toBe(false);
    expect(nativeStatusContract.pullRequests.keyTags("env_a")).toEqual(["environment:env_a"]);
    for (const action of [nativeStatusContract.markReady, nativeStatusContract.markDraft]) {
      expect(action.input.parse({ environmentId: "env_a" })).toEqual({ environmentId: "env_a" });
      expect(action.invalidates({ environmentId: "env_a" })).toEqual(["environment:env_a"]);
      expect(action.input.safeParse({ environmentId: "env_a", url: "wrong" }).success).toBe(false);
    }
    expect(nativeStatusContract.merge.input.parse({ environmentId: "env_a", method: "squash" }).method).toBe("squash");
  });
});
