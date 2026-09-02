import type { DragEvent as ReactDragEvent } from "react";

type NativeDragInput = {
  threadId: string;
  onDragThreadChange(threadId: string | null): void;
  onDropTargetChange(target: null): void;
};

/** Native HTML drag is the reliable fallback for pointer-based sidebar moves. */
export function createThreadRowNativeDragHandlers({
  threadId,
  onDragThreadChange,
  onDropTargetChange,
}: NativeDragInput) {
  return {
    startNativeDrag(event: ReactDragEvent<HTMLDivElement>) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", threadId);
      onDragThreadChange(threadId);
      onDropTargetChange(null);
    },
    finishNativeDrag() {
      onDragThreadChange(null);
      onDropTargetChange(null);
    },
  };
}
