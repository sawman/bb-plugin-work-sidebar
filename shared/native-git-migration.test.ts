import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { createChangesRegistration } from "../features/changes/server-registration";
import { createThreadRegistration } from "../features/threads/server-registration";
import type { ChangesCompositionDependencies } from "./server-composition-dependencies";

const workspace = {
  branch: { currentBranch: "feature/one", defaultBranch: "main" },
  checkout: { kind: "branch", branchName: "feature/one" },
  mergeBase: { mergeBaseBranch: "origin/main", aheadCount: 3, behindCount: 2 },
  workingTree: { state: "dirty_uncommitted", hasUncommittedChanges: true,
    files: [{ path: "src/file.ts", status: "M", insertions: 2, deletions: 1 }] },
};

function migratedHost(outputs: Record<string, unknown>) {
  const callRpc = vi.fn(async ({ pluginId, method, outputSchema }: {
    pluginId: string; method: string; outputSchema: { parse(value: unknown): unknown };
  }) => {
    expect(pluginId).toBe("bb--git");
    if (!(method in outputs)) throw new Error(`Unexpected native method: ${method}`);
    return outputSchema.parse(outputs[method]);
  });
  const bb = {
    sdk: { threads: { get: async () => ({ environmentId: "env_one" }) },
      environments: {}, plugins: { callRpc } },
    settings: { define: vi.fn(), get: vi.fn(), select: vi.fn(), boolean: vi.fn(), number: vi.fn() },
    events: { on: vi.fn() },
    storage: { kv: { get: vi.fn(), set: vi.fn() } }, realtime: { publish: vi.fn() },
  } as unknown as BbPluginApi;
  return { bb, callRpc };
}

function changesRegistration(bb: BbPluginApi) {
  return createChangesRegistration({ bb, pullRequests: {} } as ChangesCompositionDependencies);
}

describe("BB 0.49 public native Git registration boundary", () => {
  it("projects repository status through native workspaceStatus with no removed SDK methods", async () => {
    const { bb, callRpc } = migratedHost({ workspaceStatus: { outcome: "available", workspace } });
    await expect(changesRegistration(bb).getChangesRepository({ threadId: "thr_one" })).resolves.toMatchObject({
      outcome: "available", branch: "feature/one", ahead: 3, behind: 2,
      changedFileCount: 1, changedInsertions: 2, changedDeletions: 1,
    });
    expect(callRpc).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      method: "workspaceStatus", input: { environmentId: "env_one" },
    }));
  });

  it("keeps branch-divergence deduplication and numeric native branch limits", async () => {
    const { bb, callRpc } = migratedHost({
      workspaceStatus: { outcome: "available", workspace: { ...workspace, mergeBase: null } },
      branches: { remoteBranches: ["upstream/feature/one"] },
    });
    const registration = createThreadRegistration(bb, {} as never);
    await expect(registration.sidebarBranchDivergence({ targets: [
      { threadId: "thr_one", environmentId: "env_one", branchName: "feature/one" },
      { threadId: "thr_two", environmentId: "env_one", branchName: "feature/one" },
    ] })).resolves.toEqual({ divergences: { thr_one: null, thr_two: null } });
    expect(callRpc.mock.calls.map(([request]) => request.method)).toEqual(["workspaceStatus", "branches", "workspaceStatus"]);
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "branches", input: {
      environmentId: "env_one", query: "feature/one", selectedBranch: "feature/one", limit: 20,
    } }));
  });

  it("uses the native file revision for a keyed patch, without duplicate listing", async () => {
    const patchKey = JSON.stringify(["env_one", { type: "uncommitted" }, false, "src/file.ts", "revision_one"]);
    const { bb, callRpc } = migratedHost({
      files: { outcome: "available", files: [{ path: "src/file.ts", binary: false, revision: "revision_one" }], initialPatches: [], truncated: false },
      patches: { [patchKey]: { outcome: "available", patch: { path: "src/file.ts", patch: "@@ -1 +1 @@\n-old\n+new", truncated: false } } },
    });
    await expect(changesRegistration(bb).getWorkingTreeFileDiff({ threadId: "thr_one", path: "src/file.ts" })).resolves.toMatchObject({
      kind: "patch", patch: "@@ -1 +1 @@\n-old\n+new",
    });
    expect(callRpc.mock.calls.map(([request]) => request.method)).toEqual(["files", "patches"]);
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "files", input: {
      environmentId: "env_one", target: { type: "uncommitted" }, ignoreWhitespace: false,
    } }));
    expect(callRpc).toHaveBeenCalledWith(expect.objectContaining({ method: "patches", input: { keys: [patchKey] } }));
  });

  it.each(["omitted", "wrong-path", "malformed"])("keeps %s patch rows unavailable rather than confirming absence", async (scenario) => {
    const patchKey = JSON.stringify(["env_one", { type: "uncommitted" }, false, "src/file.ts", "revision_one"]);
    const patches = scenario === "omitted" ? {} : { [patchKey]: {
      outcome: "available", patch: { path: scenario === "wrong-path" ? "other.ts" : "src/file.ts",
        patch: "text", truncated: scenario === "malformed" ? "false" : false },
    } };
    const { bb, callRpc } = migratedHost({
      files: { outcome: "available", files: [{ path: "src/file.ts", binary: false, revision: "revision_one" }], initialPatches: [], truncated: false },
      patches,
    });
    await expect(changesRegistration(bb).getWorkingTreeFileDiff({ threadId: "thr_one", path: "src/file.ts" })).resolves.toMatchObject({
      kind: "unavailable", patch: null,
    });
    expect(callRpc).toHaveBeenCalledTimes(2);
  });
});
