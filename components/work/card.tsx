import type { ReactNode } from "react";

export function WorkCard({ className = "", children, ...props }: { className?: string; children: ReactNode } & React.ComponentPropsWithoutRef<"article">) {
  // Deliberately do not inherit the legacy `.ws-card` cascade. Work surfaces
  // have one stable primitive contract regardless of which panel renders it.
  return <article {...props} className={`ws-surface ${className}`.trim()}>{children}</article>;
}

export function WorkCardHeading({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return <div className="ws-surface-heading"><strong>{title}</strong>{trailing}</div>;
}
