import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

type MenuState = {
  close(): void;
  openAt(x: number, y: number): void;
  position: { x: number; y: number } | null;
};

const MenuContext = createContext<MenuState | null>(null);
const VIEWPORT_INSET = 8;

type Point = { x: number; y: number };
type Size = { height: number; width: number };

export function fitContextMenuPosition(
  anchor: Point,
  menu: Size,
  viewport: Size,
  inset = VIEWPORT_INSET,
) {
  const maxLeft = Math.max(inset, viewport.width - menu.width - inset);
  const left = Math.min(Math.max(inset, anchor.x), maxLeft);
  const fitsBelow = anchor.y + menu.height + inset <= viewport.height;
  const top = fitsBelow
    ? Math.max(inset, anchor.y)
    : Math.max(inset, anchor.y - menu.height);
  return { left, top };
}

export function ContextMenu({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(
    null,
  );
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [position]);
  return (
    <MenuContext.Provider
      value={{
        position,
        openAt: (x, y) => setPosition({ x, y }),
        close: () => setPosition(null),
      }}
    >
      {children}
    </MenuContext.Provider>
  );
}

export function ContextMenuTrigger({
  children,
}: {
  children: ReactElement<HTMLAttributes<HTMLElement>>;
  asChild?: boolean;
}) {
  const menu = useContext(MenuContext);
  if (!menu) return children;
  return cloneElement(children, {
    onContextMenu: (event: React.MouseEvent) => {
      children.props.onContextMenu?.(event as React.MouseEvent<HTMLElement>);
      event.preventDefault();
      menu.openAt(event.clientX, event.clientY);
    },
    onKeyDown: (event: React.KeyboardEvent) => {
      children.props.onKeyDown?.(event as React.KeyboardEvent<HTMLElement>);
      if (
        event.defaultPrevented ||
        (event.key !== "ContextMenu" &&
          !(event.key === "F10" && event.shiftKey))
      )
        return;
      event.preventDefault();
      const bounds = event.currentTarget.getBoundingClientRect();
      menu.openAt(bounds.left + Math.min(bounds.width, 12), bounds.bottom);
    },
  });
}

export function ContextMenuContent({
  children,
  style,
  className,
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  const menu = useContext(MenuContext);
  const contentRef = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState<
    (Point & { anchorX: number; anchorY: number }) | null
  >(null);
  const anchorX = menu?.position?.x;
  const anchorY = menu?.position?.y;
  useLayoutEffect(() => {
    if (
      anchorX === undefined ||
      anchorY === undefined ||
      !contentRef.current
    )
      return;
    const bounds = contentRef.current.getBoundingClientRect();
    const update = () => {
      const position = fitContextMenuPosition(
        { x: anchorX, y: anchorY },
        { width: bounds.width, height: bounds.height },
        { width: window.innerWidth, height: window.innerHeight },
      );
      setFitted({
        x: position.left,
        y: position.top,
        anchorX,
        anchorY,
      });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [anchorX, anchorY]);
  if (!menu?.position) return null;
  const isFitted =
    fitted?.anchorX === menu.position.x && fitted.anchorY === menu.position.y;
  const menuStyle: CSSProperties = {
    position: "fixed",
    left: isFitted ? fitted.x : menu.position.x,
    top: isFitted ? fitted.y : menu.position.y,
    zIndex: 1000,
    visibility: isFitted ? undefined : "hidden",
    ...style,
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div
      ref={contentRef}
      {...props}
      className={`ws-context-menu${className ? ` ${className}` : ""}`}
      role="menu"
      data-portalled="true"
      style={menuStyle}
      onPointerDown={(event) => event.stopPropagation()}
    >
      {children}
    </div>,
    document.body,
  );
}

export function ContextMenuItem({
  children,
  onSelect,
  onClick,
  onKeyDown,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  onSelect?(event: React.MouseEvent<HTMLButtonElement>): void;
}) {
  const menu = useContext(MenuContext);
  return (
    <button
      type="button"
      {...props}
      className={`ws-context-menu-item${className ? ` ${className}` : ""}`}
      role="menuitem"
      onClick={(event) => {
        onClick?.(event);
        onSelect?.(event);
        menu?.close();
      }}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        if (
          !event.defaultPrevented &&
          (event.key === "Enter" || event.key === " ")
        ) {
          event.preventDefault();
          event.currentTarget.click();
        }
      }}
    >
      {children}
    </button>
  );
}

export function ContextMenuLabel({ children }: { children: ReactNode }) {
  return <strong className="ws-context-menu-label">{children}</strong>;
}
export function ContextMenuInfo({ children }: { children: ReactNode }) {
  return (
    <div className="ws-context-menu-info" role="menuitem" aria-disabled="true">
      {children}
    </div>
  );
}
export function ContextMenuSeparator() {
  return <hr className="ws-context-menu-separator" />;
}
