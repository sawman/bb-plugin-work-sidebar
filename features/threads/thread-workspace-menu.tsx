import { ContextMenuInfo, ContextMenuItem } from "@/components/ui/context-menu";
import { useWorkspaceRestoreQuery, workspaceRestoreState } from "./use-workspace-restore";

/** Mounted by the open menu only; no eager per-thread workspace reads. */
export function ThreadWorkspaceMenu({
  threadId,
  projectId,
  pending,
  onRestore,
  onResumeInNewWorktree,
}: {
  threadId: string;
  projectId: string;
  pending: boolean;
  onRestore(): void;
  onResumeInNewWorktree(): void;
}) {
  const query = useWorkspaceRestoreQuery(threadId);
  if (pending) return (
    <ContextMenuItem disabled>Restoring workspace…</ContextMenuItem>
  );
  if (query.isPending || query.isFetching) return (
    <ContextMenuItem disabled>Checking workspace…</ContextMenuItem>
  );
  if (query.isError) return (
    <>
      <ContextMenuInfo>Workspace check unavailable</ContextMenuInfo>
      <ContextMenuItem onSelect={() => void query.refetch()}>Retry workspace check</ContextMenuItem>
    </>
  );
  const state = workspaceRestoreState(query.data, threadId, projectId);
  if (state === "provisioning") return (
    <ContextMenuItem disabled>Restoring workspace…</ContextMenuItem>
  );
  if (state === "restorable") return (
    <ContextMenuItem onSelect={onRestore}>Restore workspace</ContextMenuItem>
  );
  if (state === "unsupported") return (
    <ContextMenuItem onSelect={onResumeInNewWorktree}>
      Resume in new worktree
    </ContextMenuItem>
  );
  return null;
}
