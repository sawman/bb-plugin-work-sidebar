import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import { createStore } from "zustand/vanilla";
import { useEffect, type PropsWithChildren, type ReactElement } from "react";

export type QueryPolicy = Readonly<{
  staleTime: number;
  gcTime: number;
  retry: false;
  refetchOnWindowFocus: false;
}>;

const queryRoot = ["work-sidebar"] as const;

export const queryKeys = {
  sidebar: {
    order: (): QueryKey => [...queryRoot, "sidebar", "order"],
    tasks: (): QueryKey => [...queryRoot, "sidebar", "tasks"],
  },
  work: {
    context: (threadId: string): QueryKey => [...queryRoot, "work", "context", threadId],
    changes: (threadId: string): QueryKey => [...queryRoot, "work", "changes", threadId],
  },
  github: {
    health: (): QueryKey => [...queryRoot, "github", "health"],
  },
} as const;

export const queryPolicies = {
  sidebar: {
    staleTime: 0,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  work: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
  github: {
    staleTime: 30_000,
    gcTime: 5 * 60_000,
    retry: false,
    refetchOnWindowFocus: false,
  },
} as const satisfies Record<string, QueryPolicy>;

// A frontend bundle generation has one module instance per app window. Both
// independently mounted BB slots therefore observe this one client, while a
// reload naturally creates a fresh generation and client.
const pluginQueryClient = new QueryClient({
  defaultOptions: {
    queries: queryPolicies.sidebar,
  },
});

export type PluginInteractionState = {
  selectedWorkTab: "work" | "changes" | "agents";
  setSelectedWorkTab(tab: PluginInteractionState["selectedWorkTab"]): void;
};

// Interaction-only state is deliberately separate from future RPC records.
// This is one module-generation store, shared by independently mounted slots.
export const pluginInteractionStore = createStore<PluginInteractionState>((set) => ({
  selectedWorkTab: "work",
  setSelectedWorkTab: (selectedWorkTab) => set({ selectedWorkTab }),
}));

let mountedProviderCount = 0;

export function getPluginQueryClient(): QueryClient {
  return pluginQueryClient;
}

export function getMountedPluginProviderCount(): number { return mountedProviderCount; }

export function PluginProviders({ children }: PropsWithChildren): ReactElement {
  useEffect(() => {
    mountedProviderCount += 1;
    return () => { mountedProviderCount -= 1; };
  }, []);
  return <QueryClientProvider client={pluginQueryClient}>{children}</QueryClientProvider>;
}
