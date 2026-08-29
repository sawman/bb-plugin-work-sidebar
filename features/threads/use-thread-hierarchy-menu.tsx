import { useId } from "react";
import { toast } from "sonner";
import { useThreadHierarchy } from "./thread-hierarchy-context";

export const THREAD_TO_TOP_DESCRIPTION =
  "Move this thread out of its parent and make it a top-level thread";

export function useThreadHierarchyMenu({
  threadId,
  title,
  onFocusReturn,
}: {
  threadId: string;
  title: string;
  onFocusReturn(): void;
}) {
  const hierarchy = useThreadHierarchy();
  const descriptionId = useId();
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
      const { bottom, left, right, top } = nextAnchor.getBoundingClientRect();
      hierarchy.openPicker({
        anchor: nextAnchor,
        anchorRect: { bottom, left, right, top },
        onFocusReturn,
        threadId,
        title,
      });
    },
    promote,
    toTopDescription: THREAD_TO_TOP_DESCRIPTION,
    toTopDescriptionId: descriptionId,
  };
}
