import {
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { experimental_useSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import type { ThreadRowProps } from "./thread-row-types";

type ThreadRowPointerDragInput = Pick<
  ThreadRowProps,
  | "thread"
  | "groupId"
  | "reorderDisabled"
  | "canDropThread"
  | "onDragThreadChange"
  | "onDropTargetChange"
  | "onMoveToGroup"
  | "onDropThread"
> & {
  onArchive(): void;
};

export function useThreadRowPointerDrag({
  thread,
  groupId,
  reorderDisabled,
  canDropThread,
  onDragThreadChange,
  onDropTargetChange,
  onMoveToGroup,
  onDropThread,
  onArchive,
}: ThreadRowPointerDragInput) {
  const { splitProps, isAvailable } = experimental_useSidebarThreadSplit(
    thread.id,
  );
  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);
  const startUnifiedDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    // BB receives every eligible primary gesture before optional local reorder.
    if (
      event.button !== 0 ||
      (event.target as HTMLElement).closest("button,input,textarea")
    )
      return;
    splitProps.onPointerDown?.(event);
    if (reorderDisabled) return;
    const pointerId = event.pointerId;
    let active = false;
    const targetAt = (x: number, y: number) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-ws-thread-id]") ?? null;
    const zoneAt = (x: number, y: number) =>
      document
        .elementFromPoint(x, y)
        ?.closest<HTMLElement>("[data-ws-thread-drop-zone]")?.dataset
        .wsThreadDropZone ?? null;
    const clear = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", finish);
      cleanupRef.current = null;
      onDragThreadChange(null);
      onDropTargetChange(null);
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
      const target = targetAt(moveEvent.clientX, moveEvent.clientY);
      const targetId = target?.dataset.wsThreadId ?? null;
      const targetGroup = target?.dataset.wsThreadGroup ?? null;
      const zone = zoneAt(moveEvent.clientX, moveEvent.clientY);
      if (
        (targetGroup && targetGroup !== (groupId ?? "active")) ||
        (!targetId && zone && zone !== groupId)
      ) {
        active = true;
        onDragThreadChange(thread.id);
        onDropTargetChange({
          threadId: targetGroup ?? zone!,
          placement: "after",
        });
        moveEvent.preventDefault();
        return;
      }
      if (!targetId || targetId === thread.id || !canDropThread(thread.id)) {
        if (active) {
          onDragThreadChange(null);
          onDropTargetChange(null);
        }
        return;
      }
      const targetElement = document.querySelector<HTMLElement>(
        `[data-ws-thread-id="${CSS.escape(targetId)}"]`,
      );
      if (!targetElement) return;
      active = true;
      const bounds = targetElement.getBoundingClientRect();
      onDragThreadChange(thread.id);
      onDropTargetChange({
        threadId: targetId,
        placement:
          moveEvent.clientY > bounds.top + bounds.height / 2
            ? "after"
            : "before",
      });
      moveEvent.preventDefault();
    };
    const finish = (finishEvent: PointerEvent) => {
      if (finishEvent.pointerId === pointerId && active) {
        const zone = zoneAt(finishEvent.clientX, finishEvent.clientY);
        const target = targetAt(finishEvent.clientX, finishEvent.clientY);
        const targetId = target?.dataset.wsThreadId ?? null;
        const targetGroup = target?.dataset.wsThreadGroup ?? null;
        if (!targetId && zone === "archive") onArchive();
        else if (!targetId && zone && zone !== groupId)
          onMoveToGroup(thread.id, zone === "active" ? null : zone);
        else if (targetGroup && targetGroup !== (groupId ?? "active"))
          onMoveToGroup(
            thread.id,
            targetGroup === "active" ? null : targetGroup,
          );
        else if (
          targetId &&
          targetId !== thread.id &&
          canDropThread(thread.id)
        ) {
          const bounds = target!.getBoundingClientRect();
          onDropThread(
            thread.id,
            targetId,
            finishEvent.clientY > bounds.top + bounds.height / 2
              ? "after"
              : "before",
          );
        }
      }
      clear();
    };
    cleanupRef.current?.();
    cleanupRef.current = clear;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", finish);
  };
  return { isAvailable, startUnifiedDrag };
}
