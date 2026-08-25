import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from "react";

export function ContextMenu({ children }: { children: ReactNode }) { return <>{children}</>; }
export function ContextMenuTrigger({ children }: { children: ReactNode; asChild?: boolean }) { return <>{children}</>; }
export function ContextMenuContent({ children, ...props }: HTMLAttributes<HTMLDivElement>) { return <div {...props}>{children}</div>; }
export function ContextMenuItem({ children, onSelect, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { onSelect?(): void }) { return <button type="button" {...props} onClick={onSelect}>{children}</button>; }
export function ContextMenuLabel({ children }: { children: ReactNode }) { return <strong>{children}</strong>; }
export function ContextMenuSeparator() { return <hr />; }
