import type { QueryClient } from "@tanstack/react-query";
import type { PluginRpcClient } from "@get-bb/plugin-sdk/app";
import type { rpcContract } from "../../contracts";
import { changesKeys, remoteChangesIdentity } from "./model";

export function invalidateChanges(
  client: {
    getQueriesData?: (filters: { queryKey: readonly unknown[] }) => Array<[readonly unknown[], unknown]>;
    cancelQueries?: (filters: { queryKey: readonly unknown[] }) => Promise<unknown>;
    invalidateQueries(filters: {
      queryKey: readonly unknown[];
    }): Promise<unknown> | unknown;
  },
  threadId: string,
) {
  const summaries = client.getQueriesData?.({ queryKey: ["work-sidebar", "changes"] }) ?? [];
  const current = summaries.find(([key]) => key[2] === threadId && key[3] === "summary")?.[1];
  const identity = remoteChangesIdentity(current as Parameters<typeof remoteChangesIdentity>[0]);
  const related = identity ? summaries.filter(([key, value]) => key[3] === "summary"
    && remoteChangesIdentity(value as Parameters<typeof remoteChangesIdentity>[0])?.repository === identity.repository
  ).map(([key]) => String(key[2])) : [];
  return Promise.all([
    ...(identity ? [client.invalidateQueries({ queryKey: changesKeys.remoteFiles(identity.repository) })] : []),
    ...[...new Set(related)].filter((entry) => entry !== threadId).flatMap((entry) => [
      client.invalidateQueries({ queryKey: changesKeys.summary(entry) }),
      client.invalidateQueries({ queryKey: changesKeys.projection(entry) }),
      client.invalidateQueries({ queryKey: ["work-sidebar", "changes", entry, "pull-request-file-diff"] }),
    ]),
    client.invalidateQueries({ queryKey: ["work-sidebar", "changes", threadId, "pull-request-file-diff"] }),
    client.invalidateQueries({ queryKey: changesKeys.repository(threadId) }),
    client.invalidateQueries({ queryKey: changesKeys.summary(threadId) }),
    client.invalidateQueries({ queryKey: changesKeys.projection(threadId) }),
  ]);
}

/** Retire server/raw work before refetching the related semantic Query keys. */
export async function refreshChanges(rpc: PluginRpcClient<typeof rpcContract>, client: QueryClient, threadId: string) {
  const summary = client.getQueryData<Parameters<typeof remoteChangesIdentity>[0]>(changesKeys.summary(threadId));
  const identity = remoteChangesIdentity(summary);
  if (identity) {
    await client.cancelQueries({ queryKey: changesKeys.remoteFiles(identity.repository) });
    const related = client.getQueriesData({ queryKey: ["work-sidebar", "changes"] })
      .filter(([key, value]) => key[3] === "summary" && remoteChangesIdentity(value as Parameters<typeof remoteChangesIdentity>[0])?.repository === identity.repository);
    await Promise.all([...new Set([threadId, ...related.map(([key]) => String(key[2]))])].flatMap((entry) =>
      ["summary", "projection", "pull-request-file-diff"].map((stage) =>
        client.cancelQueries({ queryKey: ["work-sidebar", "changes", entry, stage] }),
      ),
    ));
  }
  await rpc.call("invalidateChangesRemote", { repository: identity?.repository ?? null });
  return invalidateChanges(client, threadId);
}

export async function invalidateRemoteChangesForRepository(client: QueryClient, repository: string) {
  const normalized = repository.toLowerCase();
  const summaries = client.getQueriesData({ queryKey: ["work-sidebar", "changes"] });
  const related = summaries.filter(([key, value]) => key[3] === "summary"
    && remoteChangesIdentity(value as Parameters<typeof remoteChangesIdentity>[0])?.repository === normalized);
  const keys = [changesKeys.remoteFiles(normalized), ...related.flatMap(([key]) =>
    ["summary", "projection", "pull-request-file-diff"].map((stage) => ["work-sidebar", "changes", key[2], stage] as const))];
  await Promise.all(keys.map((queryKey) => client.cancelQueries({ queryKey })));
  await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })));
}

export function changesShareRepository(client: QueryClient, firstThread: string, secondThread: string) {
  const first = remoteChangesIdentity(client.getQueryData(changesKeys.summary(firstThread)));
  const second = remoteChangesIdentity(client.getQueryData(changesKeys.summary(secondThread)));
  return Boolean(first && second && first.repository === second.repository);
}
