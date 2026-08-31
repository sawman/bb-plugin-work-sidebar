import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";

type DropTarget =
  | { kind: "reorder"; threadId: string; placement: "before" | "after" }
  | { kind: "reparent"; parentThreadId: string | null }
  | null;

export function useArchivedThreadPointerDrag({
  threadId,
  onDragThreadChange,
  onDropTargetChange,
  onRestore,
}: {
  threadId: string;
  onDragThreadChange(threadId: string | null): void;
  onDropTargetChange(target: DropTarget): void;
  onRestore(destination: string | null): void;
}) {
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  return (event: ReactPointerEvent<HTMLElement>) => {
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest(
        "button,input,textarea,[role=button]",
      )
    )
      return;
    const pointerId = event.pointerId;
    let active = false;
    const zoneAt = (x: number, y: number) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-ws-thread-drop-zone]")?.dataset
        .wsThreadDropZone ?? null;
    const resetPresentation = () => {
      onDragThreadChange(null);
      onDropTargetChange(null);
    };
    const clear = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cleanupRef.current = null;
      resetPresentation();
    };
    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerId) return;
      if (
        !active &&
        Math.hypot(
          moveEvent.clientX - event.clientX,
          moveEvent.clientY - event.clientY,
        ) < 5
      )
        return;
      const zone = zoneAt(moveEvent.clientX, moveEvent.clientY);
      if (!zone || zone === "archive") {
        if (active) resetPresentation();
        return;
      }
      active = true;
      onDragThreadChange(threadId);
      onDropTargetChange({
        kind: "reorder",
        threadId: zone,
        placement: "after",
      });
      moveEvent.preventDefault();
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerId && active) {
        const zone = zoneAt(finishEvent.clientX, finishEvent.clientY);
        if (zone && zone !== "archive")
          onRestore(zone === "active" ? null : zone);
      }
      clear();
    };
    cleanupRef.current?.();
    cleanupRef.current = clear;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
}
