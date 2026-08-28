import type { ComponentPropsWithoutRef, ReactNode } from "react";

type SurfaceCardProps = {
  className?: string;
  children: ReactNode;
} & ComponentPropsWithoutRef<"article">;

export function SurfaceCard({ className = "", children, ...props }: SurfaceCardProps) {
  return (
    <article {...props} className={`ws-card ${className}`.trim()}>
      {children}
    </article>
  );
}

export function SurfaceCardHeading({ title, trailing }: { title: string; trailing?: ReactNode }) {
  return (
    <div className="ws-card-heading">
      <strong>{title}</strong>
      {trailing ? (
        <span className="ws-card-heading-info">{trailing}</span>
      ) : null}
    </div>
  );
}
