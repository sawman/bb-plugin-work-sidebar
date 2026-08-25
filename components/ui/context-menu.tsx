import {
  cloneElement,
  createContext,
  useContext,
  useEffect,
  useState,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type HTMLAttributes,
  type ReactElement,
  type ReactNode,
} from "react";

type MenuState = {
  close(): void;
  openAt(x: number, y: number): void;
  position: { x: number; y: number } | null;
};

const MenuContext = createContext<MenuState | null>(null);

export function ContextMenu({ children }: { children: ReactNode }) {
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  useEffect(() => {
    if (!position) return;
    const close = () => setPosition(null);
    window.addEventListener("pointerdown", close);
    window.addEventListener("keydown", close);
    return () => {
      window.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", close);
    };
  }, [position]);
  return <MenuContext.Provider value={{ position, openAt: (x, y) => setPosition({ x, y }), close: () => setPosition(null) }}>{children}</MenuContext.Provider>;
}

export function ContextMenuTrigger({ children }: { children: ReactElement<HTMLAttributes<HTMLElement>>; asChild?: boolean }) {
  const menu = useContext(MenuContext);
  if (!menu) return children;
  return cloneElement(children, {
    onContextMenu: (event: React.MouseEvent) => {
      children.props.onContextMenu?.(event as React.MouseEvent<HTMLElement>);
      event.preventDefault();
      menu.openAt(event.clientX, event.clientY);
    },
  });
}

export function ContextMenuContent({ children, style, className, ...props }: HTMLAttributes<HTMLDivElement>) {
  const menu = useContext(MenuContext);
  if (!menu?.position) return null;
  const menuStyle: CSSProperties = { position: "fixed", left: menu.position.x, top: menu.position.y, zIndex: 1000, ...style };
  return <div {...props} className={`ws-context-menu${className ? ` ${className}` : ""}`} role="menu" style={menuStyle} onPointerDown={(event) => event.stopPropagation()}>{children}</div>;
}

export function ContextMenuItem({ children, onSelect, onClick, className, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?(): void }) {
  const menu = useContext(MenuContext);
  return <button type="button" {...props} className={`ws-context-menu-item${className ? ` ${className}` : ""}`} role="menuitem" onClick={(event) => { onClick?.(event); onSelect?.(); menu?.close(); }}>{children}</button>;
}

export function ContextMenuLabel({ children }: { children: ReactNode }) { return <strong className="ws-context-menu-label">{children}</strong>; }
export function ContextMenuSeparator() { return <hr className="ws-context-menu-separator" />; }
