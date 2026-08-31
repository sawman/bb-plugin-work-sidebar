import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

export type NumericSettingDescriptor = Readonly<{
  label: string;
  min: number;
  max: number;
  step: string;
  suffix: string;
  validate(value: string): { value: number | null; error: string | null };
  successMessage(value: number): string;
  initialValue: number;
}>;

export function SettingsCard({
  title,
  className,
  children,
}: {
  title?: string;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      data-layout="narrow"
      className={`ws-settings-card ${className}`.trim()}
    >
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  );
}

export function SettingsRow({
  compact,
  className,
  children,
}: {
  compact: boolean;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`${compact ? "ws-thread-appearance-entry " : ""}${className}`.trim()}
    >
      {children}
    </div>
  );
}

export function NumericAutosaveEditor({
  setting,
  saved,
  pending,
  compact = false,
  className = "",
  onSave,
}: {
  setting: NumericSettingDescriptor;
  saved: number | undefined;
  pending: boolean;
  compact?: boolean;
  className?: string;
  onSave(value: number): Promise<number>;
}) {
  const inputId = useId();
  const errorId = `${inputId}-error`;
  const [draft, setDraft] = useState(String(setting.initialValue));
  const [dirty, setDirty] = useState(false);
  const [changeVersion, setChangeVersion] = useState(0);
  const latestDraft = useRef(draft);
  const lastAttemptedDraft = useRef<string | null>(null);
  const onSaveRef = useRef(onSave);
  const successMessageRef = useRef(setting.successMessage);
  const labelRef = useRef(setting.label);
  const locallySavedDraft = useRef<string | null>(null);
  const validation = setting.validate(draft);

  useEffect(() => {
    onSaveRef.current = onSave;
    successMessageRef.current = setting.successMessage;
    labelRef.current = setting.label;
  }, [onSave, setting.label, setting.successMessage]);

  useEffect(() => {
    if (saved === undefined || dirty) return;
    const next = String(saved);
    if (locallySavedDraft.current !== null) {
      if (locallySavedDraft.current === next) locallySavedDraft.current = null;
      else return;
    }
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
      void onSaveRef
        .current(requested)
        .then((savedValue) => {
          if (latestDraft.current !== attemptedDraft) return;
          const next = String(savedValue);
          latestDraft.current = next;
          locallySavedDraft.current = next;
          setDraft(next);
          setDirty(false);
          toast.success(successMessageRef.current(savedValue));
        })
        .catch((error: unknown) => {
          toast.error(
            error instanceof Error
              ? error.message
              : `Could not save ${labelRef.current.toLowerCase()}`,
          );
        });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [changeVersion, dirty, draft, pending, saved, validation.value]);

  return (
    <SettingsRow compact={compact} className={className}>
      <label htmlFor={inputId}>{setting.label}</label>
      <div className="ws-settings-input-row">
        <input
          id={inputId}
          type="number"
          min={setting.min}
          max={setting.max}
          step={setting.step}
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
        <span aria-hidden>{setting.suffix}</span>
      </div>
      {validation.error ? (
        <small id={errorId} className="ws-settings-error" role="alert">
          {validation.error}
        </small>
      ) : null}
    </SettingsRow>
  );
}
