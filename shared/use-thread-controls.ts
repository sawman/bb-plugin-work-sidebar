import {
  experimental_useThreadActions,
  useBbNavigate,
  useSdk,
  type PluginThreadActionTarget,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";

type ThreadControlTarget = Pick<PluginThreadActionTarget, "id" | "projectId" | "parentThreadId" | "isUnread"> & {
  archivedAt?: number | null;
  pinnedAt?: number | null;
  sectionId?: string | null;
  status?: PluginThreadActionTarget["status"];
  environment?: { id: string | null; path: string | null } | null;
};

/** Host navigation and optimistic writes; BB still owns recursive confirmation. */
export function useThreadControls(thread: ThreadControlTarget) {
  const sdk = useSdk();
  const navigate = useBbNavigate();
  const lifecycleActions = experimental_useThreadActions({
    id: thread.id,
    projectId: thread.projectId,
    parentThreadId: thread.parentThreadId,
    isUnread: thread.isUnread,
    archivedAt: thread.archivedAt ?? null,
    pinnedAt: thread.pinnedAt ?? null,
    sectionId: thread.sectionId ?? null,
    status: thread.status ?? "idle",
    environment: thread.environment?.id ? { id: thread.environment.id, path: thread.environment.path } : null,
  }, { keys: ["bb--core/archive", "bb--core/delete"] });
  const runLifecycle = (key: string) => {
    const entry = lifecycleActions.find((candidate) => candidate.key === key);
    return entry && !entry.action.disabled ? entry.action.run() : Promise.resolve();
  };
  const writeThread = async (write: () => Promise<unknown>, fallback: string) => {
    try {
      await write();
    } catch (error) {
      // The SDK owns optimistic state and rollback. Contain failures for row
      // event handlers while preserving the old host's visible error feedback.
      toast.error(error instanceof Error ? error.message : fallback);
    }
  };
  return {
    canArchive: lifecycleActions.some((entry) => entry.key === "bb--core/archive" && !entry.action.disabled),
    canDelete: lifecycleActions.some((entry) => entry.key === "bb--core/delete" && !entry.action.disabled),
    open: navigate.toThread,
    openNewThread: navigate.toCompose,
    rename: (threadId: string, title: string) => writeThread(
      () => sdk.threads.update({ threadId, title }), "Could not rename thread",
    ),
    setPinned: (threadId: string, pinned: boolean) => writeThread(
      () => pinned ? sdk.threads.pin({ threadId }) : sdk.threads.unpin({ threadId }),
      "Could not update thread pin",
    ),
    setRead: (threadId: string, read: boolean) => writeThread(
      () => read ? sdk.threads.markRead({ threadId }) : sdk.threads.markUnread({ threadId }),
      "Could not update thread read state",
    ),
    archive: (_threadId: string) => runLifecycle("bb--core/archive"),
    requestDelete: (_threadId: string) => runLifecycle("bb--core/delete"),
  };
}
