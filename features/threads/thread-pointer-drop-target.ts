export type ThreadPointerDropTarget = Readonly<{
  thread: HTMLElement | null;
  zone: string | null;
  parentThreadId: string | null;
  toTop: boolean;
}>;

/**
 * Classifies the DOM hit target for the one thread pointer controller. It
 * carries no drag state and does not perform mutations.
 */
export function threadPointerDropTargetAt(
  clientX: number,
  clientY: number,
): ThreadPointerDropTarget {
  const element = document.elementFromPoint(clientX, clientY);
  return {
    thread: element?.closest<HTMLElement>("[data-ws-thread-id]") ?? null,
    zone:
      element?.closest<HTMLElement>("[data-ws-thread-drop-zone]")?.dataset
        .wsThreadDropZone ?? null,
    parentThreadId:
      element?.closest<HTMLElement>("[data-ws-thread-reparent-target]")
        ?.dataset.wsThreadReparentTarget ?? null,
    toTop: Boolean(
      element?.closest<HTMLElement>("[data-ws-thread-to-top-drop-zone]"),
    ),
  };
}
