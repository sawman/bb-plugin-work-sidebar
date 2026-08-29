import { useEffect, useId, useRef, useState } from "react";
import { toast } from "sonner";
import { useSidebarAppearancePreferences } from "./queries";
import {
  DEFAULT_SIDEBAR_ROW_HEIGHT,
  DEFAULT_TEXT_SCALE,
  MAX_SIDEBAR_ROW_HEIGHT,
  MAX_TEXT_SCALE,
  MIN_SIDEBAR_ROW_HEIGHT,
  MIN_TEXT_SCALE,
  validateSidebarRowHeight,
  validateTextScale,
} from "./sidebar-appearance";

type SidebarRowHeightEditorProps = {
  saved: number | undefined;
  pending: boolean;
  compact?: boolean;
  onSave(rowHeight: number): Promise<{ rowHeight: number }>;
};

type NumericAppearanceEditorProps = {
  saved: number | undefined;
  pending: boolean;
  label: string;
  min: number;
  max: number;
  step: string;
  suffix: string;
  validate(value: string): { value: number | null; error: string | null };
  onSave(value: number): Promise<number>;
  successMessage(value: number): string;
  hint?: string;
  initialValue: number;
  className: string;
};

function NumericAppearanceEditor({
  saved,
  pending,
  label,
  min,
  max,
  step,
  suffix,
  validate,
  onSave,
  successMessage,
  hint,
  initialValue,
  className,
}: NumericAppearanceEditorProps) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(String(initialValue));
  const [dirty, setDirty] = useState(false);
  const [changeVersion, setChangeVersion] = useState(0);
  const latestDraft = useRef(draft);
  const lastAttemptedDraft = useRef<string | null>(null);
  const validation = validate(draft);

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
        .then((savedValue) => {
          if (latestDraft.current !== attemptedDraft) return;
          const next = String(savedValue);
          latestDraft.current = next;
          setDraft(next);
          setDirty(false);
          toast.success(successMessage(savedValue));
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error ? error.message : `Could not save ${label.toLowerCase()}`,
          );
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [
    changeVersion,
    dirty,
    draft,
    label,
    onSave,
    pending,
    saved,
    successMessage,
    validation.value,
  ]);

  return (
    <div className={className}>
      <label htmlFor={inputId}>{label}</label>
      <div className="ws-settings-input-row">
        <input
          id={inputId}
          type="number"
          min={min}
          max={max}
          step={step}
          inputMode="decimal"
          value={draft}
          aria-invalid={validation.error ? "true" : undefined}
          aria-describedby={validation.error ? errorId : undefined}
          onChange={(event) => {
            latestDraft.current = event.currentTarget.value;
            lastAttemptedDraft.current = null;
            setDraft(latestDraft.current);
            setDirty(true);
            setChangeVersion((current) => current + 1);
          }}
        />
        <span aria-hidden>{suffix}</span>
      </div>
      {hint ? <small>{hint}</small> : null}
      {validation.error ? (
        <small id={errorId} className="ws-settings-error" role="alert">
          {validation.error}
        </small>
      ) : null}
    </div>
  );
}

export function SidebarRowHeightEditor({
  saved,
  pending,
  compact = false,
  onSave,
}: SidebarRowHeightEditorProps) {
  return (
    compact ? (
      <NumericAppearanceEditor
        saved={saved}
        pending={pending}
        label="Row height"
        min={MIN_SIDEBAR_ROW_HEIGHT}
        max={MAX_SIDEBAR_ROW_HEIGHT}
        step="0.1"
        suffix="px"
        validate={validateSidebarRowHeight}
        onSave={async (value) => (await onSave(value)).rowHeight}
        successMessage={(value) => `Sidebar rows set to ${value}px`}
        initialValue={DEFAULT_SIDEBAR_ROW_HEIGHT}
        className="ws-sidebar-row-height-editor"
      />
    ) : (
      <div
        data-layout="narrow"
        className="ws-settings-card ws-sidebar-appearance-settings"
      >
        <strong>Sidebar appearance</strong>
        <NumericAppearanceEditor
          saved={saved}
          pending={pending}
          label="Row height"
          min={MIN_SIDEBAR_ROW_HEIGHT}
          max={MAX_SIDEBAR_ROW_HEIGHT}
          step="0.1"
          suffix="px"
          validate={validateSidebarRowHeight}
          onSave={async (value) => (await onSave(value)).rowHeight}
          successMessage={(value) => `Sidebar rows set to ${value}px`}
          initialValue={DEFAULT_SIDEBAR_ROW_HEIGHT}
          className="ws-sidebar-appearance-field"
        />
      </div>
    )
  );
}

type SidebarTextScaleEditorProps = {
  saved: number | undefined;
  pending: boolean;
  compact?: boolean;
  onSave(value: number): Promise<{ textScale: number }>;
};

export function SidebarTextScaleEditor({
  saved,
  pending,
  compact = false,
  onSave,
}: SidebarTextScaleEditorProps) {
  return (
    compact ? (
      <NumericAppearanceEditor
        saved={saved}
        pending={pending}
        label="Text scale"
        min={MIN_TEXT_SCALE}
        max={MAX_TEXT_SCALE}
        step="0.01"
        suffix="×"
        validate={validateTextScale}
        onSave={async (value) => (await onSave(value)).textScale}
        successMessage={(value) => `Text scale set to ${value}`}
        hint="Compact 0.90 · Default 1.00 · Comfortable 1.10"
        initialValue={DEFAULT_TEXT_SCALE}
        className="ws-sidebar-text-scale-editor"
      />
    ) : (
      <div
        data-layout="narrow"
        className="ws-settings-card ws-sidebar-text-scale-editor"
      >
        <strong>Text scale</strong>
        <NumericAppearanceEditor
          saved={saved}
          pending={pending}
          label="Text scale"
          min={MIN_TEXT_SCALE}
          max={MAX_TEXT_SCALE}
          step="0.01"
          suffix="×"
          validate={validateTextScale}
          onSave={async (value) => (await onSave(value)).textScale}
          successMessage={(value) => `Text scale set to ${value}`}
          hint="Compact 0.90 · Default 1.00 · Comfortable 1.10"
          initialValue={DEFAULT_TEXT_SCALE}
          className="ws-sidebar-appearance-field"
        />
      </div>
    )
  );
}

export function SidebarAppearanceSettings() {
  const preferences = useSidebarAppearancePreferences();
  return (
    <div className="ws-settings-card ws-sidebar-appearance-settings" data-layout="narrow">
      <strong>Sidebar appearance</strong>
      <SidebarRowHeightEditor
        saved={preferences.appearance.data?.rowHeight}
        pending={preferences.saveAppearance.isPending}
        onSave={(rowHeight) =>
          preferences.saveAppearance.mutateAsync({ rowHeight })
        }
        compact
      />
      <SidebarTextScaleEditor
        saved={preferences.appearance.data?.textScale}
        pending={preferences.saveAppearance.isPending}
        onSave={(textScale) =>
          preferences.saveAppearance.mutateAsync({ textScale })
        }
        compact
      />
    </div>
  );
}
