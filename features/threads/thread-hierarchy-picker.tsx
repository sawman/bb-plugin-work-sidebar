import { useId, useState } from "react";
import { SearchCombobox } from "../../components/ui/combobox";
import type { ThreadHierarchyCandidate } from "./hierarchy-model";

/** The compact anchored Move under picker; it is intentionally not a dialog. */
export function ThreadHierarchyPicker({
  anchor,
  anchorRect,
  candidates,
  threadId,
  title,
  open,
  pendingThreadId,
  move: moveThread,
  onClose,
}: {
  anchor: HTMLElement | null;
  anchorRect: Pick<DOMRect, "bottom" | "left" | "right" | "top"> | null;
  candidates: readonly ThreadHierarchyCandidate[];
  threadId: string;
  title: string;
  open: boolean;
  pendingThreadId: string | null;
  move(threadId: string, parentThreadId: string | null): Promise<unknown>;
  onClose(): void;
}) {
  const titleId = useId();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  if (!open) return null;
  const move = async (parentThreadId: string) => {
    setMoving(true);
    setError(null);
    try {
      await moveThread(threadId, parentThreadId);
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move thread");
    } finally {
      setMoving(false);
    }
  };
  return (
    <SearchCombobox
      anchor={anchor}
      anchorRect={anchorRect}
      ariaDescribedBy={titleId}
      ariaLabel={`New parent for ${title}`}
      busy={moving || pendingThreadId === threadId}
      className="ws-hierarchy-combobox"
      closeOnSelect={false}
      emptyMessage="No compatible parent threads."
      error={error ? { message: error } : null}
      header={
        <span>
          <strong id={titleId}>Move under a thread</strong>
          <small>{title}</small>
        </span>
      }
      listboxLabel="Compatible parent threads"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onRetry={() => setError(null)}
      onSelectionChange={(values) => {
        const parentThreadId = values[0];
        if (parentThreadId) void move(parentThreadId);
      }}
      open
      options={candidates.map((thread) => ({
        value: thread.id,
        label: thread.title,
        detail: `Current root: ${thread.rootTitle}`,
      }))}
      placeholder="Search threads…"
      portal
      selectedValues={[]}
    />
  );
}
