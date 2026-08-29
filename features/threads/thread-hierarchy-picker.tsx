import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Combobox } from "../../components/ui/combobox";
import { Icon } from "../../components/ui/icon";
import { useThreadHierarchy } from "./thread-hierarchy-context";

export function ThreadHierarchyPicker({
  threadId,
  title,
  open,
  onClose,
}: {
  threadId: string;
  title: string;
  open: boolean;
  onClose(): void;
}) {
  const hierarchy = useThreadHierarchy();
  const [selection, setSelection] = useState("");
  const [error, setError] = useState<string | null>(null);
  const candidates = hierarchy.candidates(threadId);
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);
  if (!open || typeof document === "undefined") return null;
  const move = async (parentThreadId: string) => {
    setSelection(parentThreadId);
    setError(null);
    try {
      await hierarchy.move(threadId, parentThreadId);
      onClose();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not move thread",
      );
    }
  };
  return createPortal(
    <div
      className="ws-hierarchy-dialog-backdrop"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="ws-hierarchy-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ws-hierarchy-dialog-title"
      >
        <header>
          <div>
            <strong id="ws-hierarchy-dialog-title">Move under a thread</strong>
            <span>{title}</span>
          </div>
          <button type="button" aria-label="Close hierarchy picker" onClick={onClose}>
            <Icon name="X" aria-hidden />
          </button>
        </header>
        <Combobox
          value={selection}
          disabled={hierarchy.pendingThreadId === threadId}
          options={candidates.map((thread) => ({
            value: thread.id,
            label: thread.title,
          }))}
          onChange={(parentThreadId) => void move(parentThreadId)}
          placeholder="Search threads…"
          ariaLabel={`New parent for ${title}`}
          className="ws-hierarchy-combobox"
        />
        {candidates.length === 0 ? (
          <p className="ws-card-note">No compatible parent threads.</p>
        ) : null}
        {error ? <p role="alert">{error}</p> : null}
      </section>
    </div>,
    document.body,
  );
}
