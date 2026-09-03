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

const queryRoot = ["work-sidebar"] as const;
export const workOutcomeQueryRoot = (): QueryKey => [
  ...queryRoot,
  "work",
  "outcome",
];

export const queryKeys = {
  assets: {
    providerLogo: (logoUrl: string): QueryKey => [
      ...queryRoot,
      "assets",
      "provider-logo",
      logoUrl,
    ],
  },
  agents: {
    details: (threadIds: readonly string[]): QueryKey => [
      ...queryRoot,
      "agents",
      "details",
      ...threadIds,
    ],
  },
  sidebar: {
    order: (): QueryKey => [...queryRoot, "sidebar", "order"],
    tasks: {
      list: (): QueryKey => [...queryRoot, "sidebar", "tasks", "list"],
      links: (): QueryKey => [...queryRoot, "sidebar", "tasks", "links"],
    },
  },
  work: {
    itemQueue: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "item-queue",
      threadId,
    ],
    status: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "status",
      threadId,
    ],
    activity: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "activity",
      threadId,
    ],
    backgroundJobs: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "background-jobs",
      threadId,
    ],
    outcome: (threadId: string): QueryKey => [
      ...workOutcomeQueryRoot(),
      threadId,
    ],
    goal: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "goal",
      threadId,
    ],
    plan: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "plan",
      threadId,
    ],
    providerHealth: (providerId: string, environmentId: string | null = null): QueryKey => [
      ...queryRoot,
      "work",
      "provider-health",
      providerId,
      environmentId ?? "global",
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
