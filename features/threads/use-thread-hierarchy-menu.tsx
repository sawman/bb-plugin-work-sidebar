import { useCallback, useId, useState } from "react";
import { toast } from "sonner";
import { ThreadHierarchyPicker } from "./thread-hierarchy-picker";
import { useThreadHierarchy } from "./thread-hierarchy-context";

export const THREAD_TO_TOP_DESCRIPTION =
  "Move this thread out of its parent and make it a top-level thread";

export function useThreadHierarchyMenu({
  threadId,
  title,
}: {
  threadId: string;
  title: string;
}) {
  const hierarchy = useThreadHierarchy();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const descriptionId = useId();
  const close = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      document
        .querySelector<HTMLElement>(`[data-sidebar-thread-id="${threadId}"]`)
        ?.focus();
    });
  }, [threadId]);
  const promote = async () => {
    try {
      await hierarchy.move(threadId, null);
      toast.success(THREAD_TO_TOP_DESCRIPTION);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not move thread",
      );
    }
  };
  return {
    disabled: !hierarchy.ready || hierarchy.pendingThreadId === threadId,
    open: (nextAnchor: HTMLElement) => {
      setAnchor(nextAnchor);
      setOpen(true);
    },
    promote,
    toTopDescription: THREAD_TO_TOP_DESCRIPTION,
    toTopDescriptionId: descriptionId,
    picker: (
      <ThreadHierarchyPicker
        threadId={threadId}
        title={title}
        anchor={anchor}
        open={open}
        onClose={close}
      />
    ),
  };
}
