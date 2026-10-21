import { useQuery, type QueryClient } from "@tanstack/react-query";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { queryKeys, queryPolicies } from "../../query-runtime";
import { projectStorageListing, STORAGE_ENTRY_LIMIT } from "./thread-storage-model";

export function useThreadStorage(threadId: string) {
  const sdk = useSdk();
  return useQuery({
    queryKey: queryKeys.work.storage(threadId),
    queryFn: async ({ signal }) => {
      try {
        return projectStorageListing(await sdk.threads.storagePaths({
          threadId,
          limit: String(STORAGE_ENTRY_LIMIT),
          includeDirectories: "true",
          includeFiles: "true",
          signal,
        }));
      } catch {
        // Host transport errors may include absolute storage paths.
        throw new Error("Could not load thread storage");
      }
    },
    ...queryPolicies.threadStorage,
    refetchOnMount: "always",
    refetchInterval: false,
  });
}

/** Explicit cancellation also replaces a pending initial read (invalidation alone cannot). */
export async function refreshThreadStorage(client: QueryClient, threadId: string) {
  const filters = { queryKey: queryKeys.work.storage(threadId), exact: true };
  await client.cancelQueries(filters);
  await client.invalidateQueries(filters);
}
