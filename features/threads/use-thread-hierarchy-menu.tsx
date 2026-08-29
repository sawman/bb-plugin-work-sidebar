import { useCallback, useState } from "react";
import { toast } from "sonner";
import { ThreadHierarchyPicker } from "./thread-hierarchy-picker";
import { useThreadHierarchy } from "./thread-hierarchy-context";

export function useThreadHierarchyMenu({
  threadId,
  title,
}: {
  threadId: string;
  title: string;
}) {
  const hierarchy = useThreadHierarchy();
  const [open, setOpen] = useState(false);
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
      toast.success(`${title} is now top-level`);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not move thread",
      );
    }
  };
  return {
    disabled: !hierarchy.ready || hierarchy.pendingThreadId === threadId,
    open: () => setOpen(true),
    promote,
    picker: (
      <ThreadHierarchyPicker
        threadId={threadId}
        title={title}
        open={open}
        onClose={close}
      />
    ),
  };
}
