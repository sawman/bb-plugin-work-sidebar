import { QueryClient, QueryClientProvider, type QueryKey } from "@tanstack/react-query";
import type { PropsWithChildren, ReactElement } from "react";

export type QueryPolicy = Readonly<{
  staleTime: number;
  gcTime: number;
  retry: false;
  refetchOnWindowFocus: false;
}>;

const queryRoot = ["work-sidebar"] as const;

export const queryKeys = {
  registration: (): QueryKey => [...queryRoot, "registration"],
} as const;

export const queryPolicies = {
  registration: {
    staleTime: 0,
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
    queries: queryPolicies.registration,
  },
});

export function getPluginQueryClient(): QueryClient {
  return pluginQueryClient;
}

export function PluginProviders({ children }: PropsWithChildren): ReactElement {
  return <QueryClientProvider client={pluginQueryClient}>{children}</QueryClientProvider>;
}
