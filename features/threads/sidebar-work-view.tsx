import { useEffect, useReducer, type ReactNode } from "react";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RecycleBinEntry } from "./recycle-bin";
import type { ProviderRetry } from "./schemas";

type SidebarWorkViewProps = {
  toolbar: ReactNode;
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  providerRetriesByThread: ReadonlyMap<string, ProviderRetry>;
  searchQuery: string;
  emptyMessage: string;
  recycleBinEntries: readonly RecycleBinEntry[];
  allThreads: readonly PluginSidebarThread[];
  disclosures: Readonly<Record<string, boolean>>;
  onDisclosureChange(id: string, open: boolean): void;
  disclosuresReady: boolean;
};

function useProviderRetryClock(retries: ReadonlyMap<string, ProviderRetry>) {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const now = Date.now();
  const hasScheduledRetry = [...retries.values()].some(
    (retry) => retry.sendAt !== null && retry.sendAt > now,
  );
  useEffect(() => {
    if (!hasScheduledRetry) return;
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [hasScheduledRetry]);
  return now;
}

export function SidebarWorkView({
  toolbar,
  organization,
  activeThreadId,
  providersById,
  onNavigate,
  subtextRefreshKey,
  staleWorkingMinutes,
  providerRetriesByThread,
  searchQuery,
  emptyMessage,
  recycleBinEntries,
  allThreads,
  disclosures,
  onDisclosureChange,
  disclosuresReady,
}: SidebarWorkViewProps) {
  const providerRetryNow = useProviderRetryClock(providerRetriesByThread);
  return (
    <>
      <div className="ws-list-toolbar">{toolbar}</div>
      <div className="ws-view-content">
        <SidebarThreadGroups
          organization={organization}
          activeThreadId={activeThreadId}
          providersById={providersById}
          onNavigate={onNavigate}
          subtextRefreshKey={subtextRefreshKey}
          staleWorkingMinutes={staleWorkingMinutes}
          providerRetriesByThread={providerRetriesByThread}
          providerRetryNow={providerRetryNow}
          searchQuery={searchQuery}
          emptyMessage={emptyMessage}
          recycleBinEntries={recycleBinEntries}
          allThreads={allThreads}
          disclosures={disclosures}
          onDisclosureChange={onDisclosureChange}
          disclosuresReady={disclosuresReady}
        />
      </div>
    </>
  );
}
