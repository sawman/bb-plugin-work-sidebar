import { useState } from "react";
import { experimental_useSidebarThreadActions } from "@get-bb/plugin-sdk/app";
import { threadTitle } from "@/work-model";
import type { ThreadRowProps } from "./thread-row-types";

type ThreadRowActionInput = Pick<
  ThreadRowProps,
  "thread" | "groupId" | "onMoveToGroup" | "onNavigate"
>;

export function useThreadRowActions({
  thread,
  groupId,
  onMoveToGroup,
  onNavigate,
}: ThreadRowActionInput) {
  const actions = experimental_useSidebarThreadActions();
  const [renaming, setRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(threadTitle(thread));
  const open = (split = false) => {
    actions.open(thread.id, { split });
    onNavigate();
  };
  const commitRename = async () => {
    const next = draftTitle.trim();
    if (next && next !== threadTitle(thread))
      await actions.rename(thread.id, next);
    setRenaming(false);
  };
  const archiveTree = async () => {
    // BB owns recursive archive. Persist removing this tree from a custom
    // group first, so no archived thread retains a stale group membership.
    if (!groupId) {
      actions.archive(thread.id);
      return;
    }
    try {
      await onMoveToGroup(thread.id, null);
      await actions.archive(thread.id);
    } catch {
      // Persistence already surfaced the failure. Do not archive on a stale
      // group mutation.
    }
  };
  return {
    renaming,
    draftTitle,
    setDraftTitle,
    open,
    commitRename,
    startRename: () => setRenaming(true),
    cancelRename: () => setRenaming(false),
    archiveTree,
    requestDeleteTree: () => actions.requestDelete(thread.id),
    setPinned: (pinned: boolean) => void actions.setPinned(thread.id, pinned),
    setRead: (read: boolean) => void actions.setRead(thread.id, read),
  };
}

export type ThreadRowActions = ReturnType<typeof useThreadRowActions>;
