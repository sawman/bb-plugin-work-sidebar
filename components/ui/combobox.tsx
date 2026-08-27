import { useMemo, useState } from "react";
import { Input } from "./input";

export type ComboboxOption = { value: string; label: string; detail?: string };

/** Compact, local searchable picker for short sidebar option lists. */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  className = "",
}: {
  value: string;
  options: readonly ComboboxOption[];
  onChange(value: string): void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const visible = useMemo(
    () =>
      options.filter((option) =>
        `${option.label} ${option.detail ?? ""}`
          .toLocaleLowerCase()
          .includes(query.toLocaleLowerCase()),
      ),
    [options, query],
  );
  return (
    <div className={`ws-combobox ${className}`}>
      <Input
        value={open ? query : (selected?.label ?? "")}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={`${ariaLabel.replace(/\W+/g, "-")}-options`}
        onFocus={() => {
          setQuery("");
          setOpen(true);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            event.currentTarget.blur();
          }
        }}
      />
      {open && !disabled && (
        <>
          <div
            id={`${ariaLabel.replace(/\W+/g, "-")}-options`}
            className="ws-combobox-options"
            role="listbox"
          >
            {visible.map((option) => (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={option.value === value}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value);
                  setQuery("");
                  setOpen(false);
                }}
              >
                <span>{option.label}</span>
                {option.detail && <small>{option.detail}</small>}
              </button>
            ))}
          </div>
          {visible.length === 0 && (
            <small className="ws-combobox-empty">No matching options.</small>
          )}
        </>
      )}
    </div>
  );
}
