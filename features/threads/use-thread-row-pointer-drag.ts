import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { experimental_useSidebarThreadSplit } from "@get-bb/plugin-sdk/app";
import type { ThreadRowProps } from "./thread-row-types";
import { threadPointerDropTargetAt } from "./thread-pointer-drop-target";

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
  onReparentThread(threadId: string, parentThreadId: string | null): void;
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
  onReparentThread,
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
    const clear = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
      window.removeEventListener("pointercancel", cancel);
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
      if (!active) {
        active = true;
        onDragThreadChange(thread.id);
      }
      const pointerTarget = threadPointerDropTargetAt(
        moveEvent.clientX,
        moveEvent.clientY,
      );
      const target = pointerTarget.thread;
      const targetId = target?.dataset.wsThreadId ?? null;
      const targetGroup = target?.dataset.wsThreadGroup ?? null;
      const { parentThreadId: parentId, toTop, zone } = pointerTarget;
      if (toTop) {
        onDropTargetChange({ kind: "reparent", parentThreadId: null });
        moveEvent.preventDefault();
        return;
      }
      if (parentId && parentId !== thread.id) {
        onDropTargetChange({ kind: "reparent", parentThreadId: parentId });
        moveEvent.preventDefault();
        return;
      }
      if (
        (targetGroup && targetGroup !== (groupId ?? "active")) ||
        (!targetId && zone && zone !== groupId)
      ) {
        onDropTargetChange({
          kind: "reorder",
          threadId: targetGroup ?? zone!,
          placement: "after",
        });
        moveEvent.preventDefault();
        return;
      }
      if (!targetId || targetId === thread.id || !canDropThread(thread.id)) {
        onDropTargetChange(null);
        return;
      }
      const targetElement = document.querySelector<HTMLElement>(
        `[data-ws-thread-id="${CSS.escape(targetId)}"]`,
      );
      if (!targetElement) {
        onDropTargetChange(null);
        return;
      }
      const bounds = targetElement.getBoundingClientRect();
      onDropTargetChange({
        kind: "reorder",
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
        const pointerTarget = threadPointerDropTargetAt(
          finishEvent.clientX,
          finishEvent.clientY,
        );
        const { parentThreadId: parentId, toTop, zone } = pointerTarget;
        const target = pointerTarget.thread;
        const targetId = target?.dataset.wsThreadId ?? null;
        const targetGroup = target?.dataset.wsThreadGroup ?? null;
        if (toTop) onReparentThread(thread.id, null);
        else if (parentId && parentId !== thread.id)
          onReparentThread(thread.id, parentId);
        else if (!targetId && zone === "recycle-bin") onArchive();
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
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === pointerId) clear();
    };
    cleanupRef.current?.();
    cleanupRef.current = clear;
    window.addEventListener("pointermove", move, { passive: false });
    window.addEventListener("pointerup", finish);
    window.addEventListener("pointercancel", cancel);
  };
  return { isAvailable, startUnifiedDrag };
}
