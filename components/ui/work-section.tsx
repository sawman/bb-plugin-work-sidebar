import type { ReactNode } from "react";
import { CountedDisclosure } from "./counted-disclosure";

/** Shared counted disclosure chrome for grouped content in Work cards. */
export function WorkSection({
  id,
  title,
  count,
  countUnit,
  tone,
  metaSpacing,
  defaultOpen = false,
  className = "",
  children,
}: {
  id?: string;
  title: string;
  count: number;
  countUnit: string;
  tone?: "attention";
  metaSpacing?: "relaxed";
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  return (
    <CountedDisclosure
      className={`ws-work-section ${className}`.trim()}
      triggerId={id}
      triggerClassName="ws-work-section-trigger"
      metaClassName="ws-work-section-meta"
      countClassName="ws-work-section-count"
      iconClassName="ws-work-section-icon"
      tone={tone}
      metaSpacing={metaSpacing}
      title={title}
      count={count}
      countUnit={countUnit}
      defaultOpen={defaultOpen}
    >
      {children}
    </CountedDisclosure>
  );
}
