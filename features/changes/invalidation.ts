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

type RefreshCycle = {
  promise: Promise<void>;
  signals: WeakSet<object>;
  followup: boolean;
  threadId: string;
};
// Pending coordination only; no domain records, SDK singleton or retained timer.
const refreshCycles = new WeakMap<QueryClient, Map<string, RefreshCycle>>();

/** One remote invalidation at a time per client/repository. New events get a successor. */
export async function refreshChanges(
  rpc: PluginRpcClient<typeof rpcContract>, client: QueryClient, threadId: string,
  eventToken?: object,
) {
  const summary = client.getQueryData<Parameters<typeof remoteChangesIdentity>[0]>(changesKeys.summary(threadId));
  const identity = remoteChangesIdentity(summary);
  const scope = identity?.repository ?? "unknown";
  let cycles = refreshCycles.get(client);
  if (!cycles) { cycles = new Map(); refreshCycles.set(client, cycles); }
  let cycle = cycles.get(scope);
  if (cycle) {
    if (eventToken && !cycle.signals.has(eventToken)) {
      cycle.signals.add(eventToken); cycle.followup = true; cycle.threadId = threadId;
    }
  } else {
    if (cycles.size >= 128) throw new Error("Changes refresh capacity reached.");
    cycle = { promise: Promise.resolve(), signals: new WeakSet(), followup: false, threadId };
    if (eventToken) cycle.signals.add(eventToken);
    const active = cycle;
    const owners = cycles;
    owners.set(scope, active);
    active.promise = Promise.resolve().then(() => client.fetchQuery({
      queryKey: ["work-sidebar", "changes-refresh", scope],
      staleTime: 0, gcTime: 0, retry: false,
      queryFn: async ({ signal }) => {
        let failure: unknown;
        do {
          active.followup = false;
          failure = undefined;
          try {
            if (signal.aborted) throw new Error("Changes refresh was cancelled.");
            const target = active.threadId;
            const related = client.getQueriesData({ queryKey: ["work-sidebar", "changes"] })
              .filter(([key, value]) => key[3] === "summary" && remoteChangesIdentity(value as Parameters<typeof remoteChangesIdentity>[0])?.repository === identity?.repository);
            const threads = [...new Set([target, ...related.map(([key]) => String(key[2]))])];
            await Promise.all([
              ...(identity ? [client.cancelQueries({ queryKey: changesKeys.remoteFiles(identity.repository) })] : []),
              ...threads.flatMap((entry) => ["summary", "projection", "pull-request-file-diff"].map((stage) =>
                client.cancelQueries({ queryKey: ["work-sidebar", "changes", entry, stage] }),
              )),
            ]);
            if (signal.aborted) throw new Error("Changes refresh was cancelled.");
            await rpc.call("invalidateChangesRemote", { repository: identity?.repository ?? null });
            if (signal.aborted) throw new Error("Changes refresh was cancelled.");
            await invalidateChanges(client, target);
          } catch (error) { failure = error; }
          // Each pass consumes one coalesced set of genuinely new signals.
          // There is no retry on failure and no overlap between invalidations.
        } while (active.followup && !signal.aborted);
        if (failure) throw failure;
        return null;
      },
    })).then(() => undefined).finally(() => {
      if (owners.get(scope) === active) owners.delete(scope);
      if (!owners.size) refreshCycles.delete(client);
    });
  }
  await cycle.promise;
  if (threadId !== cycle.threadId)
    await client.invalidateQueries({ queryKey: changesKeys.repository(threadId) }, { cancelRefetch: false });
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
