import {
  QueryClient,
  QueryClientProvider,
  type QueryKey,
} from "@tanstack/react-query";
import type { ComponentType, PropsWithChildren, ReactElement } from "react";

export type QueryPolicy = Readonly<{
  staleTime: number;
  gcTime: number;
  retry: false | 1;
  refetchOnWindowFocus: false;
  refetchOnReconnect?: boolean;
}>;

export const pluginQueryRoot = ["work-sidebar"] as const;
export const workOutcomeQueryRoot = (): QueryKey => [
  ...pluginQueryRoot,
  "work",
  "outcome",
];

const taskProjectScope = (projectId: string | null) => projectId ?? "all";

export const queryKeys = {
  assets: {
    providerLogo: (logoUrl: string): QueryKey => [
      ...pluginQueryRoot,
      "assets",
      "provider-logo",
      logoUrl,
    ],
  },
  agents: {
    details: (threadIds: readonly string[]): QueryKey => [
      ...pluginQueryRoot,
      "agents",
      "details",
      ...threadIds,
    ],
  },
  sidebar: {
    order: (): QueryKey => [...pluginQueryRoot, "sidebar", "order"],
    tasks: {
      list: (projectId?: string | null): QueryKey => [
        ...pluginQueryRoot,
        "sidebar",
        "tasks",
        "list",
        ...(projectId === undefined ? [] : [taskProjectScope(projectId)]),
      ],
      links: (projectId?: string | null): QueryKey => [
        ...pluginQueryRoot,
        "sidebar",
        "tasks",
        "links",
        ...(projectId === undefined ? [] : [taskProjectScope(projectId)]),
      ],
      facts: (projectId: string | null): QueryKey => [
        ...pluginQueryRoot,
        "sidebar",
        "tasks",
        "facts",
        taskProjectScope(projectId),
      ],
    },
  },
  work: {
    itemQueue: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "item-queue",
      threadId,
    ],
    status: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "status",
      threadId,
    ],
    activity: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "activity",
      threadId,
    ],
    backgroundJobs: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "background-jobs",
      threadId,
    ],
    outcome: (threadId: string): QueryKey => [
      ...workOutcomeQueryRoot(),
      threadId,
    ],
    goal: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "goal",
      threadId,
    ],
    plan: (threadId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "plan",
      threadId,
    ],
    providerHealth: (providerId: string): QueryKey => [
      ...pluginQueryRoot,
      "work",
      "provider-health",
      providerId,
    ],
  },
} as const;

export const queryPolicies = {
  providerLogo: {
    // Provider identity and its logo route are immutable for one frontend
    // bundle generation. The host route is `no-store`, so retain the decoded
    // asset here instead of re-downloading it when sidebar rows remount.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  agentDetails: {
    // A thread's execution model is fixed when the thread is created. Keep
    // the directory for this frontend generation instead of refetching it on
    // every host activity update or Agents-tab remount.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  sidebarOrderPreferences: {
    staleTime: Infinity,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  sidebarTasksList: {
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  sidebarTaskLinks: {
    staleTime: 15_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  taskFactDirectory: {
    // The directory is hydrated by task-bearing RPC queries. It never fetches
    // independently and is retained only long enough to bridge mounted BB
    // surfaces and short tab transitions.
    staleTime: Infinity,
    // Outlive the 10-minute source-reference caches so a remount cannot
    // briefly resolve live task IDs against an already-collected directory.
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  },
  queuedMessages: {
    // Queue changes publish exact realtime signals. The active sidebar adds a
    // short foreground safety poll in case a host event is delayed or missed.
    staleTime: Infinity,
    gcTime: 5 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  workContext: {
    staleTime: 5_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  health: {
    staleTime: 15_000,
    gcTime: 2 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  providerHealth: {
    // Provider health/usage is shared by provider and environment, not by
    // thread. Keep it warm through short thread switches; the active card
    // refreshes it once per minute.
    staleTime: 60_000,
    gcTime: 10 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  workActivity: {
    staleTime: 0,
    gcTime: 2 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },
  workBackgroundJobs: {
    staleTime: 0,
    gcTime: 2 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
    refetchOnReconnect: true,
  },
} as const satisfies Record<string, QueryPolicy>;

// A frontend bundle generation has one module instance per app window. Both
// independently mounted BB slots therefore observe this one client, while a
// reload naturally creates a fresh generation and client.
const pluginQueryClient = new QueryClient({
  defaultOptions: {
    // New query families must opt into one of the named policies above.
    // This conservative fallback cannot accidentally freeze remote records.
    queries: {
      staleTime: 0,
      gcTime: 5 * 60_000,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

export function getPluginQueryClient(): QueryClient {
  return pluginQueryClient;
}

/**
 * Clear only transient plugin-owned Query state. Persisted sidebar settings,
 * groups, BB threads, Tasks, and tracker links stay intact; active views are
 * reset and immediately rebuilt from their typed RPC sources.
 */
export async function resetPluginQueryCache(client = pluginQueryClient) {
  await client.cancelQueries({ queryKey: pluginQueryRoot });
  client.removeQueries({ queryKey: pluginQueryRoot, type: "inactive" });
  await client.resetQueries({ queryKey: pluginQueryRoot });
}

export function PluginProviders({ children }: PropsWithChildren): ReactElement {
  return (
    <QueryClientProvider client={pluginQueryClient}>
      {children}
    </QueryClientProvider>
  );
}

/** The provider boundary belongs to the shared client generation, not a slot. */
export function withPluginProviders<Props extends object>(
  Component: ComponentType<Props>,
): ComponentType<Props> {
  return function PluginSlot(props: Props) {
    return (
      <PluginProviders>
        <Component {...props} />
      </PluginProviders>
    );
  };
}
