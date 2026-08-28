import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useSidebarAppearancePreferences } from "./queries";
import {
  DEFAULT_SIDEBAR_ROW_HEIGHT,
  MAX_SIDEBAR_ROW_HEIGHT,
  MIN_SIDEBAR_ROW_HEIGHT,
  validateSidebarRowHeight,
} from "./sidebar-appearance";

const INPUT_ID = "work-sidebar-row-height";
const HELP_ID = `${INPUT_ID}-help`;
const ERROR_ID = `${INPUT_ID}-error`;

export function SidebarAppearanceSettings() {
  const preferences = useSidebarAppearancePreferences();
  const [draft, setDraft] = useState(String(DEFAULT_SIDEBAR_ROW_HEIGHT));
  const [dirty, setDirty] = useState(false);
  const validation = validateSidebarRowHeight(draft);
  const saved = preferences.appearance.data?.rowHeight;

  useEffect(() => {
    if (saved !== undefined && !dirty) setDraft(String(saved));
  }, [dirty, saved]);

  return (
    <form
      className="ws-settings-card ws-sidebar-appearance-settings"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        if (validation.value === null) return;
        preferences.saveAppearance.mutate(validation.value, {
          onSuccess: ({ rowHeight }) => {
            setDraft(String(rowHeight));
            setDirty(false);
            toast.success(`Sidebar rows set to ${rowHeight}px`);
          },
          onError: (error) => {
            toast.error(
              error instanceof Error
                ? error.message
                : "Could not save sidebar row height",
            );
          },
        });
      }}
    >
      <strong>Sidebar appearance</strong>
      <label htmlFor={INPUT_ID}>Row height</label>
      <div className="ws-settings-input-row">
        <input
          id={INPUT_ID}
          type="number"
          min={MIN_SIDEBAR_ROW_HEIGHT}
          max={MAX_SIDEBAR_ROW_HEIGHT}
          step="0.1"
          inputMode="decimal"
          value={draft}
          aria-invalid={validation.error ? "true" : undefined}
          aria-describedby={`${HELP_ID}${validation.error ? ` ${ERROR_ID}` : ""}`}
          onChange={(event) => {
            setDraft(event.currentTarget.value);
            setDirty(true);
          }}
        />
        <span aria-hidden>px</span>
        <button
          type="submit"
          disabled={
            validation.value === null ||
            validation.value === saved ||
            preferences.saveAppearance.isPending
          }
        >
          {preferences.saveAppearance.isPending ? "Saving…" : "Save"}
        </button>
      </div>
      <small id={HELP_ID}>
        Enter a value with up to one decimal place from {MIN_SIDEBAR_ROW_HEIGHT} to{" "}
        {MAX_SIDEBAR_ROW_HEIGHT}px. The default is {DEFAULT_SIDEBAR_ROW_HEIGHT}px.
      </small>
      {validation.error ? (
        <small id={ERROR_ID} className="ws-settings-error" role="alert">
          {validation.error}
        </small>
      ) : null}
    </form>
  );
}
