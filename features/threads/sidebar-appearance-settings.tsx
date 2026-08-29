import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useSidebarAppearancePreferences } from "./queries";
import {
  DEFAULT_SIDEBAR_ROW_HEIGHT,
  MAX_SIDEBAR_ROW_HEIGHT,
  MIN_SIDEBAR_ROW_HEIGHT,
  validateSidebarRowHeight,
} from "./sidebar-appearance";

type SidebarRowHeightEditorProps = {
  saved: number | undefined;
  pending: boolean;
  compact?: boolean;
  onSave(rowHeight: number): Promise<{ rowHeight: number }>;
};

export function SidebarRowHeightEditor({
  saved,
  pending,
  compact = false,
  onSave,
}: SidebarRowHeightEditorProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(String(DEFAULT_SIDEBAR_ROW_HEIGHT));
  const [dirty, setDirty] = useState(false);
  const latestDraft = useRef(draft);
  const lastAttemptedDraft = useRef<string | null>(null);
  const validation = validateSidebarRowHeight(draft);

  useEffect(() => {
    if (saved === undefined || dirty) return;
    const next = String(saved);
    latestDraft.current = next;
    lastAttemptedDraft.current = null;
    setDraft(next);
  }, [dirty, saved]);

  useEffect(() => {
    if (!dirty || pending || validation.value === null) return;
    if (validation.value === saved) {
      lastAttemptedDraft.current = null;
      setDirty(false);
      return;
    }
    const requested = validation.value;
    const attemptedDraft = draft;
    if (lastAttemptedDraft.current === attemptedDraft) return;
    const timer = window.setTimeout(() => {
      lastAttemptedDraft.current = attemptedDraft;
      void onSave(requested)
        .then(({ rowHeight }) => {
          if (latestDraft.current !== attemptedDraft) return;
          const next = String(rowHeight);
          latestDraft.current = next;
          setDraft(next);
          setDirty(false);
          toast.success(`Sidebar rows set to ${rowHeight}px`);
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : "Could not save sidebar row height",
          );
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [dirty, draft, onSave, pending, saved, validation.value]);

  return (
    <div
      data-layout={compact ? undefined : "narrow"}
      className={
        compact
          ? "ws-sidebar-row-height-editor"
          : "ws-settings-card ws-sidebar-appearance-settings"
      }
    >
      {compact ? null : <strong>Sidebar appearance</strong>}
      <label htmlFor={inputId}>Row height</label>
      <div className="ws-settings-input-row">
        <input
          id={inputId}
          type="number"
          min={MIN_SIDEBAR_ROW_HEIGHT}
          max={MAX_SIDEBAR_ROW_HEIGHT}
          step="0.1"
          inputMode="decimal"
          value={draft}
          aria-invalid={validation.error ? "true" : undefined}
          aria-describedby={validation.error ? errorId : undefined}
          onChange={(event) => {
            latestDraft.current = event.currentTarget.value;
            lastAttemptedDraft.current = null;
            setDraft(latestDraft.current);
            setDirty(true);
          }}
        />
        <span aria-hidden>px</span>
      </div>
      {validation.error ? (
        <small id={errorId} className="ws-settings-error" role="alert">
          {validation.error}
        </small>
      ) : null}
    </div>
  );
}

export function SidebarAppearanceSettings() {
  const preferences = useSidebarAppearancePreferences();
  return (
    <SidebarRowHeightEditor
      saved={preferences.appearance.data?.rowHeight}
      pending={preferences.saveAppearance.isPending}
      onSave={preferences.saveAppearance.mutateAsync}
    />
  );
}
