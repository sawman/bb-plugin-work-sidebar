import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";
import { fitContextMenuPosition } from "./context-menu";
import { Icon } from "./icon";
import { SidebarListIconButton } from "./sidebar-list-actions";

export function SidebarSearch({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: string;
  onValueChange(value: string): void;
}) {
  const [open, setOpen] = useState(() => value.trim().length > 0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const restoreFocus = useRef(false);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(
    null,
  );

  const close = useCallback(
    (shouldRestoreFocus = true) => {
      onValueChange("");
      restoreFocus.current = shouldRestoreFocus;
      setOpen(false);
    },
    [onValueChange],
  );

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      return;
    }
    if (!open && restoreFocus.current) {
      restoreFocus.current = false;
      triggerRef.current?.focus();
    }
  }, [close, open]);

  useEffect(() => {
    if (!open) return;
    const ownerDocument = popoverRef.current?.ownerDocument ?? document;
    const dismissOutside = (event: PointerEvent) => {
      const target = event.target;
      const NodeConstructor = ownerDocument.defaultView?.Node;
      if (
        NodeConstructor &&
        target instanceof NodeConstructor &&
        !popoverRef.current?.contains(target) &&
        !triggerRef.current?.contains(target)
      )
        close(false);
    };
    ownerDocument.addEventListener("pointerdown", dismissOutside, true);
    return () =>
      ownerDocument.removeEventListener("pointerdown", dismissOutside, true);
  }, [close, open]);

  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const updatePosition = () => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      const popover = popoverRef.current?.getBoundingClientRect();
      if (!anchor || !popover) return;
      setPosition(
        fitContextMenuPosition(
          { x: anchor.right - popover.width, y: anchor.bottom + 4 },
          { width: popover.width, height: popover.height },
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
  }, [open]);

  const popoverStyle: CSSProperties = {
    left: position?.left ?? 8,
    top: position?.top ?? 8,
    visibility: position ? undefined : "hidden",
  };

  return (
    <>
      <SidebarListIconButton
        ref={triggerRef}
        title={`Search ${label}`}
        aria-label={`Search ${label}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="Search" aria-hidden />
      </SidebarListIconButton>
      {open && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={popoverRef}
              className="ws-sidebar-search-popover"
              role="dialog"
              aria-label={`Search ${label}`}
              data-portalled="true"
              style={popoverStyle}
            >
              <div className="ws-sidebar-search" role="search">
                <Icon name="Search" aria-hidden />
                <input
                  ref={inputRef}
                  type="search"
                  aria-label={`Search ${label}`}
                  placeholder={`Search ${label}…`}
                  value={value}
                  onChange={(event) => onValueChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    event.stopPropagation();
                    close();
                  }}
                />
                <button
                  type="button"
                  className="ws-sidebar-search-close"
                  aria-label={`Close ${label} search`}
                  title={`Close ${label} search`}
                  onClick={() => close()}
                >
                  <Icon name="X" aria-hidden />
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
