import type { ReactNode } from "react";
import {
  SurfaceCard,
  SurfaceCardHeading,
} from "../../components/ui/surface-card";

export type CardStateProps = {
  title: string;
  className?: string;
  trailing?: ReactNode;
  pending: boolean;
  error: Error | null;
  onRetry: () => void;
  children: ReactNode;
};

export function CardState({
  title,
  className = "",
  trailing,
  pending,
  error,
  onRetry,
  children,
}: CardStateProps) {
  return (
    <SurfaceCard
      className={`ws-work-context-card ${className}`}
      data-card={title.toLowerCase()}
    >
      <SurfaceCardHeading title={title} trailing={trailing} />
      {pending ? (
        <p className="ws-card-note" role="status" aria-busy="true">
          Loading {title.toLowerCase()}…
        </p>
      ) : null}
      {error ? (
        <div className="ws-card-note" role="alert">
          <span>{error.message}</span>
          <button type="button" onClick={onRetry}>
            Try again
          </button>
        </div>
      ) : null}
      {!pending && !error ? children : null}
    </SurfaceCard>
  );
}
