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

export const queryKeys = {
  sidebar: {
    order: (): QueryKey => [...queryRoot, "sidebar", "order"],
    tasks: {
      list: (): QueryKey => [...queryRoot, "sidebar", "tasks", "list"],
      links: (): QueryKey => [...queryRoot, "sidebar", "tasks", "links"],
    },
  },
  work: {
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
    outcome: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "outcome",
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
    providerHealth: (threadId: string): QueryKey => [
      ...queryRoot,
      "work",
      "provider-health",
      threadId,
    ],
  },
} as const;

export const queryPolicies = {
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
  workContext: {
    staleTime: 5_000,
    gcTime: 10 * 60_000,
    retry: 1,
    refetchOnWindowFocus: false,
  },
  workActivity: {
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
