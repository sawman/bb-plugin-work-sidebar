import { useState } from "react";
import { SearchCombobox } from "../../components/ui/combobox";
import { useThreadHierarchy } from "./thread-hierarchy-context";

/** The compact anchored Move under picker; it is intentionally not a dialog. */
export function ThreadHierarchyPicker({
  anchor,
  threadId,
  title,
  open,
  onClose,
}: {
  anchor: HTMLElement | null;
  threadId: string;
  title: string;
  open: boolean;
  onClose(): void;
}) {
  const hierarchy = useThreadHierarchy();
  const [error, setError] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  if (!open) return null;
  const candidates = hierarchy.candidates(threadId);
  const move = async (parentThreadId: string) => {
    setMoving(true);
    setError(null);
    try {
      await hierarchy.move(threadId, parentThreadId);
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
      ariaLabel={`New parent for ${title}`}
      busy={moving || hierarchy.pendingThreadId === threadId}
      className="ws-hierarchy-combobox"
      closeOnSelect={false}
      emptyMessage="No compatible parent threads."
      error={error ? { message: error } : null}
      header={
        <span>
          <strong>Move under a thread</strong>
          <small>{title}</small>
        </span>
      }
      listboxLabel="Compatible parent threads"
      onOpenChange={(nextOpen) => {
        if (!nextOpen) onClose();
      }}
      onSelectionChange={(values) => {
        const parentThreadId = values[0];
        if (parentThreadId) void move(parentThreadId);
      }}
      open
      options={candidates.map((thread) => ({
        value: thread.id,
        label: thread.title,
      }))}
      placeholder="Search threads…"
      portal
      selectedValues={[]}
    />
  );
}
