import type { QueryPolicy } from "../../query-runtime";

export const trackerKeys = { context: (threadId: string) => ["work-sidebar", "tracker", "context", threadId] as const, search: (threadId: string, query: string) => ["work-sidebar", "tracker", "search", threadId, query] as const };
export const trackerPolicy: QueryPolicy = { staleTime: 5_000, gcTime: 10 * 60_000, retry: 1, refetchOnWindowFocus: false };
