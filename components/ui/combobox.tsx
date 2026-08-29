import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { fitContextMenuPosition } from "./context-menu";
import { textScaleStyle, useTextScale } from "../../shared/text-scale";

export type ComboboxOption = {
  value: string;
  label: string;
  detail?: string;
  disabled?: boolean;
  leading?: ReactNode;
  trailing?: ReactNode;
  title?: string;
};

type AnchorRect = Pick<DOMRect, "bottom" | "left" | "right" | "top">;

export type SearchComboboxProps = {
  ariaDescribedBy?: string;
  ariaLabel: string;
  emptyMessage: string;
  listboxLabel: string;
  onOpenChange(open: boolean): void;
  onSelectionChange(values: string[]): void;
  open: boolean;
  options: readonly ComboboxOption[];
  placeholder: string;
  selectedValues: readonly string[];
  anchor?: HTMLElement | null;
  anchorRef?: RefObject<HTMLElement | null>;
  anchorRect?: AnchorRect | null;
  busy?: boolean;
  className?: string;
  closeOnSelect?: boolean;
  disabled?: boolean;
  emptyOption?: boolean;
  error?: { message: string } | null;
  footer?: ReactNode;
  header?: ReactNode;
  hideResults?: boolean;
  inputClassName?: string;
  multiple?: boolean;
  onDismiss?(): void;
  onQueryChange?(value: string): void;
  onRetry?(): void;
  portal?: boolean;
  query?: string;
  searchOnly?: boolean;
};

function contains(target: EventTarget | null, element: Element | null) {
  const NodeConstructor = element?.ownerDocument.defaultView?.Node;
  return Boolean(
    NodeConstructor && target instanceof NodeConstructor && element?.contains(target),
  );
}

/**
 * The one plugin-local compact search and combobox interaction shell. Feature
 * code owns option data and mutations; this primitive owns popup/focus/ARIA.
 */
export function SearchCombobox({
  ariaDescribedBy,
  anchor,
  anchorRef,
  anchorRect = null,
  ariaLabel,
  busy = false,
  className = "",
  closeOnSelect = true,
  disabled = false,
  emptyOption = false,
  emptyMessage,
  error = null,
  footer,
  header,
  hideResults = false,
  inputClassName = "",
  listboxLabel,
  multiple = false,
  onDismiss,
  onOpenChange,
  onQueryChange,
  onRetry,
  open,
  options,
  placeholder,
  portal = false,
  query,
  searchOnly = false,
  selectedValues,
  onSelectionChange,
}: SearchComboboxProps) {
  const textScale = useTextScale();
  const [uncontrolledQuery, setUncontrolledQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );
  const inputRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef(false);
  const dismissedByPointer = useRef(false);
  const listId = useId();
  const activeOptionId =
    activeIndex === null ? undefined : `${listId}-option-${activeIndex}`;
  const selectedLabel = !multiple
    ? options.find((option) => option.value === selectedValues[0])?.label ?? ""
    : "";
  const inputValue =
    open || searchOnly ? query ?? uncontrolledQuery : selectedLabel;
  const visible = useMemo(() => {
    const needle = inputValue.trim().toLocaleLowerCase();
    if (!needle) return options;
    return options.filter((option) =>
      `${option.label} ${option.detail ?? ""}`
        .toLocaleLowerCase()
        .includes(needle),
    );
  }, [inputValue, options]);
  const showListbox = open && !hideResults && !busy && !error && visible.length > 0;
  const hasListbox =
    open && !hideResults && (visible.length > 0 || emptyOption);
  const inputIsSearchOnly = searchOnly || (open && !hasListbox);
  const showPopup = open && (Boolean(anchor || anchorRef) || portal);

  const setQuery = (next: string) => {
    if (query === undefined) setUncontrolledQuery(next);
    onQueryChange?.(next);
  };
  const close = () => {
    restoreFocus.current = true;
    setActiveIndex(null);
    onDismiss?.();
    onOpenChange(false);
  };

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    if (!restoreFocus.current) return;
    restoreFocus.current = false;
    (anchor ?? anchorRef?.current ?? inputRef.current)?.focus();
  }, [anchor, anchorRef, open]);

  useEffect(() => {
    if (!open) return;
    dismissedByPointer.current = false;
    const ownerDocument = contentRef.current?.ownerDocument ?? document;
    const dismissOutside = (event: PointerEvent | MouseEvent) => {
      if (
        contains(event.target, contentRef.current) ||
        contains(event.target, rootRef.current) ||
        contains(event.target, anchor ?? anchorRef?.current ?? null)
      )
        return;
      if (event.type === "click" && dismissedByPointer.current) return;
      if (event.type === "pointerdown") dismissedByPointer.current = true;
      close();
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    ownerDocument.addEventListener("click", dismissOutside, true);
    return () => {
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
      ownerDocument.removeEventListener("click", dismissOutside, true);
    };
  }, [anchor, anchorRef, open]);

  useLayoutEffect(() => {
    if (!showPopup) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const content = contentRef.current?.getBoundingClientRect();
      const anchorBounds = anchorRect ?? anchor?.getBoundingClientRect() ?? anchorRef?.current?.getBoundingClientRect() ?? inputRef.current?.getBoundingClientRect();
      if (!content || !anchorBounds) return;
      setPosition(
        fitContextMenuPosition(
          { x: anchorBounds.left, y: anchorBounds.bottom + 4 },
          { width: content.width, height: content.height },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [anchor, anchorRect, anchorRef, busy, error, showPopup, visible.length]);

  useLayoutEffect(() => {
    if (!showListbox || activeIndex === null) return;
    const option = contentRef.current?.ownerDocument.getElementById(activeOptionId ?? "");
    if (option && "scrollIntoView" in option)
      option.scrollIntoView({ block: "nearest" });
  }, [activeIndex, activeOptionId, showListbox]);

  const choose = (option: ComboboxOption) => {
    if (disabled || option.disabled) return;
    const selected = selectedValues.includes(option.value);
    const next = multiple
      ? selected
        ? selectedValues.filter((value) => value !== option.value)
        : [...selectedValues, option.value]
      : [option.value];
    onSelectionChange(next);
    setQuery("");
    if (closeOnSelect && !multiple) close();
  };
  const input = (
    <input
      ref={inputRef}
      value={inputValue}
      className={`ws-search-shell-input ${inputClassName}`}
      placeholder={placeholder}
      aria-label={ariaLabel}
      aria-describedby={ariaDescribedBy}
      disabled={disabled}
      role={inputIsSearchOnly ? "searchbox" : "combobox"}
      aria-autocomplete={inputIsSearchOnly ? undefined : "list"}
      aria-controls={hasListbox && !inputIsSearchOnly ? listId : undefined}
      aria-activedescendant={showListbox ? activeOptionId : undefined}
      aria-expanded={inputIsSearchOnly ? undefined : open}
      onFocus={() => {
        if (disabled) return;
        if (!open && query === undefined) setUncontrolledQuery("");
        onOpenChange(true);
      }}
      onClick={() => {
        if (!disabled) onOpenChange(true);
      }}
      onChange={(event) => {
        setQuery(event.target.value);
        setActiveIndex(null);
        if (!disabled) onOpenChange(true);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          close();
        } else if (!inputIsSearchOnly && event.key === "ArrowDown") {
          event.preventDefault();
          if (!disabled && visible.length) {
            onOpenChange(true);
            setActiveIndex((current) =>
              current === null ? 0 : Math.min(current + 1, visible.length - 1),
            );
          }
        } else if (!inputIsSearchOnly && event.key === "ArrowUp") {
          event.preventDefault();
          if (!disabled && visible.length) {
            onOpenChange(true);
            setActiveIndex((current) =>
              current === null ? visible.length - 1 : Math.max(current - 1, 0),
            );
          }
        } else if (!inputIsSearchOnly && event.key === "Home") {
          event.preventDefault();
          if (!disabled && visible.length) {
            onOpenChange(true);
            setActiveIndex(0);
          }
        } else if (!inputIsSearchOnly && event.key === "End") {
          event.preventDefault();
          if (!disabled && visible.length) {
            onOpenChange(true);
            setActiveIndex(visible.length - 1);
          }
        } else if (!inputIsSearchOnly && event.key === "Enter" && activeIndex !== null) {
          event.preventDefault();
          const option = visible[activeIndex];
          if (option) choose(option);
        }
      }}
    />
  );

  const listbox = !hasListbox ? null : (
    <div
      id={listId}
      className="ws-search-shell-options"
      role="listbox"
      aria-label={listboxLabel}
      aria-multiselectable={multiple || undefined}
    >
      {busy ? (
        <button type="button" role="option" aria-disabled="true" disabled tabIndex={-1}>
          Loading options…
        </button>
      ) : error ? (
        <button type="button" role="option" aria-disabled="true" disabled tabIndex={-1}>
          {error.message}
        </button>
      ) : visible.length ? visible.map((option, index) => (
        <button
          key={option.value}
          id={`${listId}-option-${index}`}
          type="button"
          role="option"
          aria-selected={selectedValues.includes(option.value)}
          aria-disabled={option.disabled || undefined}
          data-active={activeIndex === index || undefined}
          disabled={option.disabled}
          tabIndex={-1}
          title={option.title}
          onMouseDown={(event) => event.preventDefault()}
          onPointerMove={() => setActiveIndex(index)}
          onClick={() => choose(option)}
        >
          {option.leading ? <span className="ws-search-shell-leading" aria-hidden>{option.leading}</span> : null}
          <span className="ws-search-shell-option-label">{option.label}</span>
          {option.detail ? <small>{option.detail}</small> : null}
          {option.trailing ? <span className="ws-search-shell-trailing" aria-hidden>{option.trailing}</span> : null}
        </button>
      )) : (
        <button type="button" role="option" aria-disabled="true" disabled tabIndex={-1}>
          {emptyMessage}
        </button>
      )}
    </div>
  );
  const results = hideResults ? null : busy ? (
    <>
      <div className="ws-search-shell-state" role="status" aria-live="polite">
        Loading options…
      </div>
      {listbox}
    </>
  ) : error ? (
    <>
      <div className="ws-search-shell-state" role="alert">
        <span>{error.message}</span>
        {onRetry ? <button type="button" onClick={onRetry}>Try again</button> : null}
      </div>
      {listbox}
    </>
  ) : (
    listbox ?? (
      <div className="ws-search-shell-state" role="status">
        {emptyMessage}
      </div>
    )
  );

  const contentStyle: CSSProperties | undefined = showPopup
    ? {
        ...textScaleStyle(textScale),
        left: position?.left ?? 8,
        top: position?.top ?? 8,
        visibility: position ? undefined : "hidden",
      }
    : undefined;
  const content = (
    <div
      ref={contentRef}
      className={`ws-search-shell-content ${className}`}
      data-portalled={showPopup || undefined}
      style={contentStyle}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {header ? <div className="ws-search-shell-header">{header}</div> : null}
      {anchorRef ? input : null}
      {open ? results : null}
      {footer ? <div className="ws-search-shell-footer">{footer}</div> : null}
    </div>
  );

  const dismissOnBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget;
    if (
      contains(next, contentRef.current) ||
      contains(next, rootRef.current) ||
      contains(next, anchor ?? anchorRef?.current ?? null)
    )
      return;
    close();
  };

  if (!open && (anchor || anchorRef)) return null;
  if (showPopup && typeof document !== "undefined")
    return (
      <div ref={rootRef} className="ws-search-shell" onBlur={dismissOnBlur}>
        {!anchorRef && input}
        {createPortal(content, document.body)}
      </div>
    );
  return (
    <div ref={rootRef} className="ws-search-shell" onBlur={dismissOnBlur}>
      {!anchorRef && input}
      {content}
    </div>
  );
}

/** Backward-compatible single-select entrypoint for the short local pickers. */
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  disabled = false,
  className = "",
  portal = false,
}: {
  value: string;
  options: readonly ComboboxOption[];
  onChange(value: string): void;
  placeholder: string;
  ariaLabel: string;
  disabled?: boolean;
  className?: string;
  portal?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <SearchCombobox
      ariaLabel={ariaLabel}
      className={`ws-combobox ${className}`}
      emptyMessage="No matching options."
      emptyOption
      listboxLabel={ariaLabel}
      onOpenChange={setOpen}
      onSelectionChange={(values) => onChange(values[0] ?? "")}
      open={open && !disabled}
      options={options.map((option) => ({ ...option, disabled: disabled || option.disabled }))}
      placeholder={placeholder}
      portal={portal}
      selectedValues={value ? [value] : []}
    />
  );
}
