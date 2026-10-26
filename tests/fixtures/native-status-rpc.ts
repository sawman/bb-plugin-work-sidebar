import { nativeStatusContract, GITHUB_PR_STATUS_PLUGIN_ID } from "../../features/pull-requests/native-status-schemas";

/** Adapt recorded enrichment fixtures to the exact native keyed wire envelope. */
export function withNativeStatusRpc<T extends { sdk: {
  nativeStatus: { read: (input: { environmentId: string }) => Promise<any> };
  plugins?: { callRpc: (...args: any[]) => Promise<any> };
} }>(fixture: T) {
  const { nativeStatus, ...sdk } = fixture.sdk;
  return { ...fixture, sdk: { ...sdk, plugins: { callRpc: async (request: any) => {
    if (request.pluginId !== GITHUB_PR_STATUS_PLUGIN_ID) return sdk.plugins?.callRpc(request);
    const rows = await Promise.all(request.input.keys.map(async (environmentId: string) => {
      const row = await nativeStatus.read({ environmentId });
      if (row.outcome !== "available") return [environmentId, row];
      const pr = row.pullRequest;
      return [environmentId, { outcome: "available", pullRequest: {
        number: pr.number, title: pr.title, url: pr.url, state: pr.state,
        headRefName: pr.headRefName, baseRefName: pr.baseRefName,
        updatedAt: pr.updatedAt ?? "2026-10-26T00:00:00Z",
        autoMerge: pr.autoMerge ?? false, inMergeQueue: pr.inMergeQueue ?? null,
        checks: pr.checks, review: pr.review, attention: pr.attention, mergeability: pr.mergeability,
      } }];
    }));
    return nativeStatusContract.pullRequests.output.parse(Object.fromEntries(rows));
  } } } };
}
