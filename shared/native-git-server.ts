import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";
import { createPluginRpcCaller, type PluginRpcInput } from "./server-plugin-rpc.js";

// Consumed projections of the public bb--git 0.49 RPC contract. Unknown host
// fields are stripped; every field used by either sidebar is validated here.
const unavailable = z.object({ outcome: z.literal("unavailable"), failure: z.object({ message: z.string() }) });
const notApplicable = z.object({ outcome: z.literal("not_applicable"), message: z.string() });
const workspace = z.object({
  branch: z.object({ currentBranch: z.string().nullable(), defaultBranch: z.string() }),
  checkout: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("branch"), branchName: z.string() }),
    z.object({ kind: z.enum(["detached", "unborn", "unknown"]) }),
  ]),
  mergeBase: z.object({ mergeBaseBranch: z.string(), aheadCount: z.number(), behindCount: z.number() }).nullable(),
  workingTree: z.object({
    state: z.string(), hasUncommittedChanges: z.boolean(),
    files: z.array(z.object({ path: z.string(), status: z.string(), insertions: z.number().nullable(), deletions: z.number().nullable() })),
  }),
});
const statusResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), workspace }), unavailable, notApplicable,
]);
const patchEntry = z.object({ path: z.string(), patch: z.string(), truncated: z.boolean() });
const filesResult = z.discriminatedUnion("outcome", [
  z.object({
    outcome: z.literal("available"), truncated: z.boolean(),
    files: z.array(z.object({ path: z.string(), binary: z.boolean(), revision: z.string().min(1) })),
    initialPatches: z.array(patchEntry),
  }), unavailable, notApplicable,
]);
const patchResult = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("available"), patch: patchEntry }), unavailable, notApplicable,
]);

/** Native Git owns repository access and caching; this adapter adds no cache. */
export function createNativeGitReader(bb: BbPluginApi) {
  const pluginRpc = createPluginRpcCaller(bb);
  const call = <T>(method: string, input: PluginRpcInput, outputSchema: z.ZodType<T>) =>
    pluginRpc("bb--git", method, input, outputSchema);
  return {
    status: (input: { environmentId: string; mergeBaseBranch?: string }) =>
      call("workspaceStatus", input, statusResult),
    diffBranches: (input: { environmentId: string; query: string; selectedBranch: string; limit: string }) =>
      call("branches", { ...input, limit: Number(input.limit) }, z.object({ remoteBranches: z.array(z.string()) })),
    diffFiles: (input: { environmentId: string; target: "uncommitted" }) =>
      call("files", { environmentId: input.environmentId, target: { type: input.target }, ignoreWhitespace: false }, filesResult),
    diffPatch: async (input: { environmentId: string; path: string; revision: string }) => {
      // Public gitPatchKey wire format, from desktop-v0.49.0's git contract.
      const key = JSON.stringify([input.environmentId, { type: "uncommitted" }, false, input.path, input.revision]);
      const rows = await call("patches", { keys: [key] }, z.record(z.string(), patchResult));
      const row = rows[key];
      if (!row) throw new Error("The Git provider omitted this file. Retry the operation.");
      if (row.outcome === "available" && row.patch.path !== input.path)
        throw new Error("The Git provider returned a different file. Retry the operation.");
      return row;
    },
  };
}
