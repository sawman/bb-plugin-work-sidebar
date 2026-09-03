import { useEffect, useReducer, type ReactNode } from "react";
import type { SidebarThreadOrganization } from "./sidebar-organization";
import { SidebarThreadGroups } from "./sidebar-group-tree";
import type { ThreadProviderDirectory } from "@/components/threads/thread-provider-logo";
import type { PluginSidebarThread } from "@get-bb/plugin-sdk/app";
import type { RecycleBinEntry } from "./recycle-bin";
import type { QueuedMessage } from "./schemas";
import type { GroupActivityPriority } from "./group-activity-priority";
import type { ThreadPullRequestDirectory } from "../pull-requests/queries";

type SidebarWorkViewProps = {
  toolbar: ReactNode;
  organization: SidebarThreadOrganization;
  activeThreadId: string | null;
  providersById: ThreadProviderDirectory;
  onNavigate(): void;
  subtextRefreshKey: number;
  staleWorkingMinutes: number;
  queuedMessagesByThread: ReadonlyMap<string, QueuedMessage>;
  groupActivityPriority: GroupActivityPriority;
  searchQuery: string;
  emptyMessage: string;
  recycleBinEntries: readonly RecycleBinEntry[];
  allThreads: readonly PluginSidebarThread[];
  disclosures: Readonly<Record<string, boolean>>;
  onDisclosureChange(id: string, open: boolean): void;
  disclosuresReady: boolean;
  pullRequestsByThread?: ThreadPullRequestDirectory;
  pullRequestsLoading: boolean;
};

function useQueuedMessageClock(messages: ReadonlyMap<string, QueuedMessage>) {
  const [, refresh] = useReducer((revision: number) => revision + 1, 0);
  const now = Date.now();
  const hasScheduledMessage = [...messages.values()].some(
    (message) => message.nextSendAt !== null && message.nextSendAt > now,
  );
  useEffect(() => {
    if (!hasScheduledMessage) return;
    const timer = window.setInterval(refresh, 1_000);
    return () => window.clearInterval(timer);
  }, [hasScheduledMessage]);
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
  queuedMessagesByThread,
  groupActivityPriority,
  searchQuery,
  emptyMessage,
  recycleBinEntries,
  allThreads,
  disclosures,
  onDisclosureChange,
  disclosuresReady,
  pullRequestsByThread,
  pullRequestsLoading,
}: SidebarWorkViewProps) {
  const queuedMessageNow = useQueuedMessageClock(queuedMessagesByThread);
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
          queuedMessagesByThread={queuedMessagesByThread}
          groupActivityPriority={groupActivityPriority}
          queuedMessageNow={queuedMessageNow}
          searchQuery={searchQuery}
          emptyMessage={emptyMessage}
          recycleBinEntries={recycleBinEntries}
          allThreads={allThreads}
          disclosures={disclosures}
          onDisclosureChange={onDisclosureChange}
          disclosuresReady={disclosuresReady}
          pullRequestsByThread={pullRequestsByThread}
          pullRequestsLoading={pullRequestsLoading}
        />
      </div>
    </>
  );
}
