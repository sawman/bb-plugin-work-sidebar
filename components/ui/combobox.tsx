import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
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
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const optionsId = useId();
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
  const showPopup = open && !disabled;
  const activeOption = activeIndex === null ? null : visible[activeIndex] ?? null;
  const optionId = (index: number) => `${optionsId}-option-${index}`;

  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (!root) return;
    const ownerDocument = root.ownerDocument;
    const dismissOutside = (event: Event) => {
      const target = event.target;
      const NodeConstructor = ownerDocument.defaultView?.Node;
      if (
        NodeConstructor &&
        target instanceof NodeConstructor &&
        !root.contains(target)
      ) {
        setOpen(false);
        setActiveIndex(null);
      }
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    ownerDocument.addEventListener("click", dismissOutside, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
      ownerDocument.removeEventListener("click", dismissOutside, true);
    };
  }, [open]);

  useLayoutEffect(() => {
    if (activeIndex === null || !showPopup) return;
    document
      .getElementById(optionId(activeIndex))
      ?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, optionsId, showPopup]);

  const selectOption = (option: ComboboxOption) => {
    onChange(option.value);
    setQuery("");
    setOpen(false);
    setActiveIndex(null);
  };

  return (
    <div
      ref={rootRef}
      className={`ws-combobox ${className}`}
      onBlur={(event) => {
        const nextFocused = event.relatedTarget as Node | null;
        if (!nextFocused || !event.currentTarget.contains(nextFocused)) {
          setOpen(false);
          setActiveIndex(null);
        }
      }}
    >
      <Input
        value={open ? query : (selected?.label ?? "")}
        placeholder={placeholder}
        aria-label={ariaLabel}
        disabled={disabled}
        role="combobox"
        aria-expanded={showPopup}
        aria-controls={showPopup ? optionsId : undefined}
        aria-activedescendant={
          showPopup && activeOption && activeIndex !== null
            ? optionId(activeIndex)
            : undefined
        }
        aria-autocomplete="list"
        onFocus={() => {
          setQuery("");
          setOpen(true);
          setActiveIndex(null);
        }}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setActiveIndex(null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActiveIndex(visible.length ? 0 : null);
            } else if (visible.length) {
              setActiveIndex((current) =>
                current === null ? 0 : Math.min(current + 1, visible.length - 1),
              );
            }
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
              setActiveIndex(visible.length ? visible.length - 1 : null);
            } else if (visible.length) {
              setActiveIndex((current) =>
                current === null ? visible.length - 1 : Math.max(current - 1, 0),
              );
            }
          } else if (event.key === "Home") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
            }
            setActiveIndex(visible.length ? 0 : null);
          } else if (event.key === "End") {
            event.preventDefault();
            if (!open) {
              setOpen(true);
            }
            setActiveIndex(visible.length ? visible.length - 1 : null);
          } else if (event.key === "Enter" && activeOption) {
            event.preventDefault();
            selectOption(activeOption);
          } else if (event.key === "Escape") {
            setOpen(false);
            setActiveIndex(null);
          }
        }}
        onClick={() => {
          if (!open) {
            setQuery("");
            setOpen(true);
            setActiveIndex(null);
          }
        }}
      />
      {showPopup && (
        <div
          id={optionsId}
          className="ws-combobox-options"
          role="listbox"
        >
          {visible.length === 0 ? (
            <small role="option" aria-disabled="true">
              No matching options.
            </small>
          ) : (
            visible.map((option, index) => {
              const active = activeIndex === index;
              return (
                <button
                  key={option.value}
                  id={optionId(index)}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  data-active={active || undefined}
                  tabIndex={-1}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => selectOption(option)}
                >
                  <span>{option.label}</span>
                  {option.detail && <small>{option.detail}</small>}
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
