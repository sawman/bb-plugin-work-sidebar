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

export type SettingsRowLayout = "thread-popup";

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
  layout,
  className,
  children,
}: {
  layout?: SettingsRowLayout;
  className: string;
  children: ReactNode;
}) {
  return (
    <div
      className={`ws-settings-row ${className}`.trim()}
      data-layout={layout}
    >
      {children}
    </div>
  );
}

export function SettingsLabel({
  htmlFor,
  children,
}: {
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <label className="ws-settings-label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export function useFieldSavedVersion<T>(saved: T) {
  const field = useRef({ saved, version: 0 });
  if (!Object.is(field.current.saved, saved))
    field.current = { saved, version: field.current.version + 1 };
  return field.current.version;
}

export function NumericAutosaveEditor({
  setting,
  saved,
  savedVersion,
  pending,
  layout,
  className = "",
  onSave,
}: {
  setting: NumericSettingDescriptor;
  saved: number | undefined;
  savedVersion?: number;
  pending: boolean;
  layout?: SettingsRowLayout;
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
  // setQueryData publishes the saved value before the mutation resolves. Keep
  // just the stale pre-save echo from replacing the successful local value;
  // any later, genuinely different external value must still win.
  const staleSavedAfterLocalSave = useRef<{
    value: string;
    version: number | undefined;
  } | null>(null);
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
      if (locallySavedDraft.current === next) {
        locallySavedDraft.current = null;
        staleSavedAfterLocalSave.current = null;
      } else if (
        staleSavedAfterLocalSave.current?.value === next &&
        staleSavedAfterLocalSave.current.version === savedVersion
      ) {
        staleSavedAfterLocalSave.current = null;
        return;
      } else {
        locallySavedDraft.current = null;
        staleSavedAfterLocalSave.current = null;
      }
    }
    latestDraft.current = next;
    lastAttemptedDraft.current = null;
    setDraft(next);
  }, [dirty, saved, savedVersion]);

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
          staleSavedAfterLocalSave.current = saved === undefined
            ? null
            : { value: String(saved), version: savedVersion };
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
  }, [changeVersion, dirty, draft, pending, saved, savedVersion, validation.value]);

  return (
    <SettingsRow layout={layout} className={className}>
      <SettingsLabel htmlFor={inputId}>{setting.label}</SettingsLabel>
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
