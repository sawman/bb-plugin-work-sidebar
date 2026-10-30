import { useEffect, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSdk } from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import { threadQueryKeys, threadQueryPolicies } from "./queries";

type WorkspaceSnapshot = Awaited<ReturnType<ReturnType<typeof useSdk>["threads"]["get"]>>;

export function workspaceRestoreState(thread: WorkspaceSnapshot, threadId: string, projectId: string) {
  if (thread.id !== threadId || thread.projectId !== projectId || thread.deletedAt !== null || thread.archivedAt !== null)
    return "unavailable";
  if (thread.runtime.displayStatus === "provisioning") return "provisioning";
  if (thread.status !== "idle" && thread.status !== "error") return "unavailable";
  const environment = "environment" in thread ? thread.environment : undefined;
  if (!environment) return "unavailable";
  if (environment.status === "ready") return "ready";
  if (environment.status !== "destroyed") return "unavailable";
  if (thread.canRestoreEnvironment === true) return "restorable";
  return thread.canRestoreEnvironment === false ? "unsupported" : "unavailable";
}

/** Menu-scoped read: the host remains the sole authority for restore eligibility. */
export function useWorkspaceRestoreQuery(threadId: string) {
  const sdk = useSdk();
  return useQuery({
    queryKey: threadQueryKeys.workspace(threadId),
    queryFn: ({ signal }) => sdk.threads.get({ threadId, include: "environment", signal }),
    ...threadQueryPolicies.workspace,
  });
}

/** Row-scoped mutation survives menu dismissal, but never outlives its target row. */
export function useWorkspaceRestore(threadId: string, projectId: string, onOpen: () => void) {
  const sdk = useSdk();
  const client = useQueryClient();
  const scopeRef = useRef<AbortController | null>(null);
  useEffect(() => {
    const scope = new AbortController();
    scopeRef.current = scope;
    return () => { scope.abort(); };
  }, [threadId, projectId]);
  const restore = useMutation({
    mutationKey: threadQueryKeys.workspace(threadId),
    retry: false,
    mutationFn: async (scope: AbortController) => {
      const thread = await sdk.threads.get({ threadId, include: "environment", signal: scope.signal });
      if (scope.signal.aborted) return false;
      const state = workspaceRestoreState(thread, threadId, projectId);
      if (state === "ready") return true;
      if (state !== "restorable")
        throw new Error("Workspace cannot be restored. Reopen the menu for current options.");
      // The host rechecks atomically. Acceptance starts provisioning, not a turn.
      const restored = await sdk.threads.restoreEnvironment({ threadId });
      if (restored.id !== threadId) throw new Error("Workspace restore returned a different thread");
      return true;
    },
    onSuccess: (accepted, scope) => {
      if (accepted && !scope.signal.aborted && scope === scopeRef.current) onOpen();
    },
    onError: (error, scope) => {
      if (!scope.signal.aborted && scope === scopeRef.current)
        toast.error(error instanceof Error ? error.message : "Could not restore workspace");
    },
    onSettled: () => client.invalidateQueries({ queryKey: threadQueryKeys.workspace(threadId) }),
  });
  return {
    pending: restore.isPending,
    restore: () => {
      const scope = scopeRef.current;
      if (scope && !scope.signal.aborted && !client.isMutating({ mutationKey: threadQueryKeys.workspace(threadId) }))
        restore.mutate(scope);
    },
  };
}
