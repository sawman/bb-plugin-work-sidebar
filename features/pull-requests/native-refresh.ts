import { useCallback, useEffect } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";

type MountedRead = { key: string; refresh(): Promise<void> };
// Only live public refresh handles, scoped to the shared window Query client.
// BB still owns the keys' data, watches, caching, retries and request batching.
const mountedReads = new WeakMap<QueryClient, Map<symbol, MountedRead>>();

export function useNativeRefreshRegistration(key: string | null | undefined, refresh: () => Promise<void>) {
  const client = useQueryClient();
  useEffect(() => {
    if (!key) return;
    let reads = mountedReads.get(client);
    if (!reads) {
      reads = new Map();
      mountedReads.set(client, reads);
    }
    const owner = Symbol("native-pr-read");
    reads.set(owner, { key, refresh });
    return () => {
      reads.delete(owner);
      if (reads.size === 0) mountedReads.delete(client);
    };
  }, [client, key, refresh]);
}

/** SDK 0.6.132 refreshes a hook's own keys; fan out only to live consumers. */
export function useNativePullRequestRefresh() {
  const client = useQueryClient();
  return useCallback(async () => {
    const targets = new Map([...mountedReads.get(client)?.values() ?? []]
      .map(({ key, refresh }) => [key, refresh]));
    await Promise.all([...targets.values()].map((refresh) => refresh()));
  }, [client]);
}
