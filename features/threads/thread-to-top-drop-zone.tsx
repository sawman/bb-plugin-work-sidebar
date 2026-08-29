import { useId } from "react";
import { THREAD_TO_TOP_DESCRIPTION } from "./use-thread-hierarchy-menu";

export function ThreadToTopDropZone({ active }: { active: boolean }) {
  const descriptionId = useId();
  return (
    <div
      className="ws-thread-to-top-drop-zone"
      data-ws-thread-to-top-drop-zone=""
      data-drop-target={active || undefined}
      role="note"
      aria-label="To Top"
      aria-describedby={descriptionId}
    >
      To Top
      <span id={descriptionId} className="ws-sr-only">
        {THREAD_TO_TOP_DESCRIPTION}
      </span>
    </div>
  );
}
